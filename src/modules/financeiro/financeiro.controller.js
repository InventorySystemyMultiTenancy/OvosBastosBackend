const prisma = require('../../config/db');
const { custoTotalDosItens } = require('../../utils/custoVenda');
const { lerDocumentoGasto } = require('./leituraDocumento.service');
const recebimentosService = require('../recebimentos/recebimentos.service');

const FORMAS_PAGAMENTO = ['PIX', 'DINHEIRO', 'CARTAO', 'BOLETO', 'FIADO'];

async function vendasHojePorForma(req, res, next) {
  try {
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);

    const vendasHoje = await prisma.venda.findMany({
      where: { status: 'CONFIRMADA', confirmadaEm: { gte: inicioHoje } },
      select: { total: true, formaPagamento: true, valorDinheiro: true },
    });

    const totais = Object.fromEntries(FORMAS_PAGAMENTO.map((forma) => [forma, 0]));
    vendasHoje.forEach((v) => {
      const total = Number(v.total);
      const dinheiro = Number(v.valorDinheiro || 0);
      // Venda com pagamento dividido: a parte em dinheiro conta pra DINHEIRO, o resto
      // (que foi cobrado na maquininha) conta pra forma de pagamento real da venda (CARTAO).
      if (dinheiro > 0 && v.formaPagamento) {
        totais.DINHEIRO += dinheiro;
        totais[v.formaPagamento] += total - dinheiro;
      } else if (v.formaPagamento) {
        totais[v.formaPagamento] += total;
      }
    });

    const totalGeral = Object.values(totais).reduce((soma, valor) => soma + valor, 0);

    res.json({
      totalGeral,
      quantidadeVendas: vendasHoje.length,
      porFormaPagamento: FORMAS_PAGAMENTO.map((forma) => ({ forma, valor: totais[forma] })),
    });
  } catch (err) {
    next(err);
  }
}

async function fornecedoresProdutos(req, res, next) {
  try {
    const [fornecedores, produtos, itens] = await Promise.all([
      prisma.fornecedor.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
      prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
      prisma.itemRecebimento.findMany({
        where: { recebimento: { fornecedorId: { not: null } } },
        select: { produtoId: true, quantidadeRecebida: true, recebimento: { select: { fornecedorId: true } } },
      }),
    ]);

    const celulas = {};
    itens.forEach((i) => {
      const chave = `${i.recebimento.fornecedorId}-${i.produtoId}`;
      celulas[chave] = (celulas[chave] || 0) + i.quantidadeRecebida;
    });

    res.json({
      fornecedores: fornecedores.map((f) => ({ id: f.id, nome: f.nome })),
      produtos: produtos.map((p) => ({ id: p.id, nome: p.nome })),
      celulas,
    });
  } catch (err) {
    next(err);
  }
}

function statusPagamento(valorTotal, valorPago) {
  if (Number(valorPago) <= 0) return 'ABERTO';
  if (Number(valorPago) >= Number(valorTotal)) return 'PAGO';
  return 'PARCIAL';
}

async function fornecedoresPagamentos(req, res, next) {
  try {
    const fornecedores = await prisma.fornecedor.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
      include: {
        recebimentos: {
          where: { fornecedorId: { not: null }, status: { not: 'EM_ANDAMENTO' } },
          select: { id: true, createdAt: true, valorTotal: true, valorPago: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    res.json(
      fornecedores.map((f) => {
        const recebimentos = f.recebimentos.map((r) => ({
          id: r.id,
          createdAt: r.createdAt,
          valorTotal: r.valorTotal,
          valorPago: r.valorPago,
          restante: Number(r.valorTotal || 0) - Number(r.valorPago),
          status: statusPagamento(r.valorTotal || 0, r.valorPago),
        }));
        const valorTotal = recebimentos.reduce((s, r) => s + Number(r.valorTotal || 0), 0);
        const valorPago = recebimentos.reduce((s, r) => s + Number(r.valorPago), 0);
        return {
          id: f.id,
          nome: f.nome,
          valorTotal,
          valorPago,
          valorEmAberto: valorTotal - valorPago,
          recebimentos,
        };
      })
    );
  } catch (err) {
    next(err);
  }
}

// ---------- Contas a pagar/receber por mês, com projeção de recorrência fixa mensal ----------
//
// Uma conta "fixa mensal" é um template (recorrente=true): a linha original criada pelo
// admin. Os meses seguintes não são pré-criados no banco — são projetados na hora de listar
// e só viram linha real quando aquele mês específico é pago ("materialização"), com
// origemRecorrenteId apontando de volta pro template. É isso que garante que marcar um mês
// como pago não afeta os meses seguintes da mesma conta fixa.

function parseMes(mesStr) {
  const hoje = new Date();
  let ano = hoje.getFullYear();
  let mes = hoje.getMonth(); // 0-indexed
  if (mesStr && /^\d{4}-\d{2}$/.test(mesStr)) {
    const [a, m] = mesStr.split('-').map(Number);
    ano = a;
    mes = m - 1;
  }
  const inicio = new Date(ano, mes, 1, 0, 0, 0, 0);
  const fim = new Date(ano, mes + 1, 0, 23, 59, 59, 999);
  return { ano, mes, inicio, fim };
}

function diaClampado(dia, ano, mes) {
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  return Math.min(dia, ultimoDia);
}

// -1 = data é de mês anterior a (ano,mes); 0 = mesmo mês; 1 = mês posterior
function compararMes(data, ano, mes) {
  const d = new Date(data);
  if (d.getFullYear() !== ano) return d.getFullYear() < ano ? -1 : 1;
  if (d.getMonth() !== mes) return d.getMonth() < mes ? -1 : 1;
  return 0;
}

async function listarContasComRecorrencia({ delegate, where = {}, include, mesStr }) {
  const { ano, mes, inicio, fim } = parseMes(mesStr);

  const [contasDoMes, templates] = await Promise.all([
    delegate.findMany({ where: { ...where, vencimento: { gte: inicio, lte: fim } }, include, orderBy: { vencimento: 'asc' } }),
    delegate.findMany({ where: { ...where, recorrente: true }, include }),
  ]);

  const materializadosPorTemplate = new Set(contasDoMes.filter((c) => c.origemRecorrenteId).map((c) => c.origemRecorrenteId));
  const templatesDoProprioMes = new Set(contasDoMes.filter((c) => c.recorrente).map((c) => c.id));

  const virtuais = [];
  templates.forEach((t) => {
    if (templatesDoProprioMes.has(t.id) || materializadosPorTemplate.has(t.id)) return;
    if (compararMes(t.vencimento, ano, mes) > 0) return; // recorrência ainda não começou nesse mês
    const dia = diaClampado(new Date(t.vencimento).getDate(), ano, mes);
    virtuais.push({ ...t, id: null, virtual: true, recorrente: false, origemRecorrenteId: t.id, pago: false, pagoEm: null, vencimento: new Date(ano, mes, dia) });
  });

  return [...contasDoMes, ...virtuais]
    .sort((a, b) => new Date(a.vencimento) - new Date(b.vencimento))
    .map((c) => ({ ...c, recorrenteTemplateId: c.recorrente ? c.id : c.origemRecorrenteId || null }));
}

async function pagarMesConta({ delegate, templateId, mesStr, camposBase }) {
  const template = await delegate.findUnique({ where: { id: Number(templateId) } });
  if (!template) throw Object.assign(new Error('Conta não encontrada'), { status: 404 });
  if (!template.recorrente) throw Object.assign(new Error('Esta conta não é uma recorrência fixa mensal'), { status: 400 });

  const { ano, mes } = parseMes(mesStr);
  const comparacao = compararMes(template.vencimento, ano, mes);
  if (comparacao > 0) throw Object.assign(new Error('Essa recorrência ainda não começa nesse mês'), { status: 400 });
  if (comparacao === 0) {
    throw Object.assign(new Error('Esse é o mês de origem da recorrência — pague a linha original diretamente'), { status: 400 });
  }

  const existente = await delegate.findFirst({
    where: {
      origemRecorrenteId: template.id,
      vencimento: { gte: new Date(ano, mes, 1), lte: new Date(ano, mes + 1, 0, 23, 59, 59, 999) },
    },
  });
  if (existente) throw Object.assign(new Error('Esse mês já foi registrado'), { status: 409 });

  const dia = diaClampado(new Date(template.vencimento).getDate(), ano, mes);
  return delegate.create({
    data: {
      ...camposBase(template),
      vencimento: new Date(ano, mes, dia),
      recorrente: false,
      origemRecorrenteId: template.id,
      pago: true,
      pagoEm: new Date(),
    },
  });
}

async function cancelarRecorrencia(delegate, id) {
  const conta = await delegate.findUnique({ where: { id: Number(id) } });
  if (!conta) throw Object.assign(new Error('Conta não encontrada'), { status: 404 });
  if (!conta.recorrente) throw Object.assign(new Error('Esta conta não é uma recorrência fixa mensal'), { status: 400 });
  return delegate.update({ where: { id: conta.id }, data: { recorrente: false } });
}

async function listarContasReceber(req, res, next) {
  try {
    const where = {};
    if (req.query.caixaId) where.caixaId = Number(req.query.caixaId);
    const contas = await listarContasComRecorrencia({
      delegate: prisma.contaReceber,
      where,
      include: { cliente: true, caixa: true },
      mesStr: req.query.mes,
    });
    res.json(contas);
  } catch (err) {
    next(err);
  }
}

async function criarContaReceber(req, res, next) {
  try {
    const { clienteId, valor, vencimento, caixaId, recorrente } = req.body;
    if (!clienteId || !valor || !vencimento) {
      return res.status(400).json({ error: 'clienteId, valor e vencimento são obrigatórios' });
    }
    const conta = await prisma.contaReceber.create({
      data: {
        clienteId: Number(clienteId),
        valor,
        vencimento: new Date(vencimento),
        caixaId: caixaId ? Number(caixaId) : null,
        recorrente: Boolean(recorrente),
      },
    });
    res.status(201).json(conta);
  } catch (err) {
    next(err);
  }
}

async function pagarContaReceber(req, res, next) {
  try {
    const conta = await prisma.contaReceber.update({
      where: { id: Number(req.params.id) },
      data: { pago: true, pagoEm: new Date() },
    });
    res.json(conta);
  } catch (err) {
    next(err);
  }
}

async function receberMesContaReceber(req, res, next) {
  try {
    const conta = await pagarMesConta({
      delegate: prisma.contaReceber,
      templateId: req.params.id,
      mesStr: req.body.mes,
      camposBase: (t) => ({ clienteId: t.clienteId, caixaId: t.caixaId, valor: t.valor }),
    });
    res.status(201).json(conta);
  } catch (err) {
    next(err);
  }
}

async function cancelarRecorrenciaContaReceber(req, res, next) {
  try {
    res.json(await cancelarRecorrencia(prisma.contaReceber, req.params.id));
  } catch (err) {
    next(err);
  }
}

async function listarContasPagar(req, res, next) {
  try {
    const where = {};
    if (req.query.caixaId) where.caixaId = Number(req.query.caixaId);
    const contas = await listarContasComRecorrencia({
      delegate: prisma.contaPagar,
      where,
      include: { caixa: true },
      mesStr: req.query.mes,
    });
    res.json(contas);
  } catch (err) {
    next(err);
  }
}

// Itens de uma conta a pagar que é compra de mercadoria (vindos da leitura por IA, conferidos
// no formulário) → itens de recebimento: tudo convertido pra grão-base e somado por produto
// (o recebimento só aceita uma linha por produto). O custo novo por grão-base sai de quanto
// foi pago ÷ quantos grãos chegaram — só quando toda linha daquele produto tem valor; senão
// o custo atual fica como está.
async function montarItensRecebimento(itensEstoque) {
  if (!Array.isArray(itensEstoque) || itensEstoque.length === 0) return [];

  const linhas = itensEstoque
    .map((i) => ({
      produtoId: Number(i.produtoId),
      nivelVendaId: i.nivelVendaId ? Number(i.nivelVendaId) : null,
      quantidade: Number(i.quantidade),
      valorTotal: i.valorTotal !== undefined && i.valorTotal !== null && i.valorTotal !== '' ? Number(i.valorTotal) : null,
    }))
    .filter((i) => i.produtoId && i.quantidade > 0);

  for (const l of linhas) {
    if (!Number.isInteger(l.quantidade)) {
      throw Object.assign(new Error('Quantidade de estoque deve ser um número inteiro'), { status: 400 });
    }
    if (l.valorTotal !== null && (Number.isNaN(l.valorTotal) || l.valorTotal < 0)) {
      throw Object.assign(new Error('Valor de item de estoque inválido'), { status: 400 });
    }
  }

  const nivelIds = linhas.filter((l) => l.nivelVendaId).map((l) => l.nivelVendaId);
  const niveis = nivelIds.length ? await prisma.nivelVendaProduto.findMany({ where: { id: { in: nivelIds } } }) : [];

  const porProduto = new Map();
  for (const l of linhas) {
    let grao = l.quantidade;
    if (l.nivelVendaId) {
      const nivel = niveis.find((n) => n.id === l.nivelVendaId && n.produtoId === l.produtoId);
      if (!nivel || !nivel.ativo) {
        throw Object.assign(new Error(`Nível de venda ${l.nivelVendaId} não pertence ao produto ${l.produtoId}`), { status: 400 });
      }
      grao = l.quantidade * nivel.quantidadeGrao;
    }
    const atual = porProduto.get(l.produtoId) || { grao: 0, valor: 0, semValor: false };
    atual.grao += grao;
    if (l.valorTotal === null) atual.semValor = true;
    else atual.valor += l.valorTotal;
    porProduto.set(l.produtoId, atual);
  }

  return Array.from(porProduto, ([produtoId, t]) => ({
    produtoId,
    quantidade: t.grao,
    precoCusto: t.semValor || t.valor <= 0 ? undefined : Number((t.valor / t.grao).toFixed(4)),
  }));
}

async function criarContaPagar(req, res, next) {
  try {
    const { descricao, fornecedor, valor, dataEmissao, vencimento, caixaId, recorrente, pago, pagoEm, itensEstoque } = req.body;
    if (!descricao || !valor || !vencimento) {
      return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios' });
    }
    // Validado antes de criar a conta — item inválido não deixa uma conta órfã pra trás.
    const itensRecebimento = await montarItensRecebimento(itensEstoque);

    const conta = await prisma.contaPagar.create({
      data: {
        descricao,
        fornecedor,
        valor,
        dataEmissao: dataEmissao ? new Date(dataEmissao) : null,
        vencimento: new Date(vencimento),
        caixaId: caixaId ? Number(caixaId) : null,
        recorrente: Boolean(recorrente),
        pago: Boolean(pago),
        pagoEm: pago ? (pagoEm ? new Date(pagoEm) : new Date()) : null,
      },
    });

    let recebimento = null;
    if (itensRecebimento.length > 0) {
      try {
        recebimento = await recebimentosService.criar({
          itens: itensRecebimento,
          observacao: `Compra da conta a pagar #${conta.id} — ${descricao}${fornecedor ? ` (${fornecedor})` : ''}`,
          criadoPorId: req.usuario?.id,
          jaFinalizado: true,
        });
      } catch (err) {
        await prisma.contaPagar.delete({ where: { id: conta.id } });
        throw err;
      }
    }

    res.status(201).json({ ...conta, recebimentoId: recebimento?.id || null });
  } catch (err) {
    next(err);
  }
}

// Só lê o documento e devolve os campos sugeridos — quem grava é o POST /contas-pagar depois
// que o admin confere o formulário preenchido.
async function lerDocumentoContaPagar(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie uma imagem ou um PDF da conta' });
    res.json(await lerDocumentoGasto(req.file));
  } catch (err) {
    next(err);
  }
}

async function pagarContaPagar(req, res, next) {
  try {
    const conta = await prisma.contaPagar.update({
      where: { id: Number(req.params.id) },
      data: { pago: true, pagoEm: new Date() },
    });
    res.json(conta);
  } catch (err) {
    next(err);
  }
}

async function pagarMesContaPagar(req, res, next) {
  try {
    const conta = await pagarMesConta({
      delegate: prisma.contaPagar,
      templateId: req.params.id,
      mesStr: req.body.mes,
      camposBase: (t) => ({ descricao: t.descricao, fornecedor: t.fornecedor, caixaId: t.caixaId, valor: t.valor }),
    });
    res.status(201).json(conta);
  } catch (err) {
    next(err);
  }
}

async function cancelarRecorrenciaContaPagar(req, res, next) {
  try {
    res.json(await cancelarRecorrencia(prisma.contaPagar, req.params.id));
  } catch (err) {
    next(err);
  }
}

function chaveMes(data) {
  const d = new Date(data);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function fluxoCaixa(req, res, next) {
  try {
    const meses = Number(req.query.meses) || 6;
    const desde = new Date();
    desde.setMonth(desde.getMonth() - (meses - 1));
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const [vendas, contasPagas] = await Promise.all([
      prisma.venda.findMany({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } },
        select: { total: true, confirmadaEm: true },
      }),
      prisma.contaPagar.findMany({
        where: { pago: true, pagoEm: { gte: desde } },
        select: { valor: true, pagoEm: true },
      }),
    ]);

    const mapa = {};
    for (let i = 0; i < meses; i++) {
      const d = new Date(desde);
      d.setMonth(d.getMonth() + i);
      mapa[chaveMes(d)] = { mes: chaveMes(d), receitas: 0, despesas: 0 };
    }

    vendas.forEach((v) => {
      const chave = chaveMes(v.confirmadaEm);
      if (mapa[chave]) mapa[chave].receitas += Number(v.total);
    });
    contasPagas.forEach((c) => {
      const chave = chaveMes(c.pagoEm);
      if (mapa[chave]) mapa[chave].despesas += Number(c.valor);
    });

    const serie = Object.values(mapa).map((m) => ({ ...m, saldo: m.receitas - m.despesas }));
    res.json(serie);
  } catch (err) {
    next(err);
  }
}

async function resumoPorCaixa(req, res, next) {
  try {
    const { de, ate } = req.query;
    const periodoVenda = {};
    const periodoPagar = {};
    if (de || ate) {
      periodoVenda.confirmadaEm = {};
      periodoPagar.pagoEm = {};
      if (de) {
        periodoVenda.confirmadaEm.gte = new Date(de);
        periodoPagar.pagoEm.gte = new Date(de);
      }
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        periodoVenda.confirmadaEm.lte = fim;
        periodoPagar.pagoEm.lte = fim;
      }
    }

    const [caixas, receitasPorCaixa, despesasPorCaixa] = await Promise.all([
      prisma.caixa.findMany({ orderBy: { id: 'asc' } }),
      prisma.venda.groupBy({
        by: ['caixaId'],
        where: { status: 'CONFIRMADA', ...periodoVenda },
        _sum: { total: true },
      }),
      prisma.contaPagar.groupBy({
        by: ['caixaId'],
        where: { pago: true, ...periodoPagar },
        _sum: { valor: true },
      }),
    ]);

    const receitaMap = new Map(receitasPorCaixa.map((r) => [r.caixaId, Number(r._sum.total || 0)]));
    const despesaMap = new Map(despesasPorCaixa.map((d) => [d.caixaId, Number(d._sum.valor || 0)]));

    const linhas = caixas.map((c) => {
      const receitas = receitaMap.get(c.id) || 0;
      const despesas = despesaMap.get(c.id) || 0;
      return { id: c.id, nome: c.nome, unidade: c.unidade, ativo: c.ativo, receitas, despesas, saldo: receitas - despesas };
    });

    const semUnidade = {
      receitas: receitaMap.get(null) || 0,
      despesas: despesaMap.get(null) || 0,
    };
    semUnidade.saldo = semUnidade.receitas - semUnidade.despesas;

    const total = linhas.reduce(
      (acc, l) => ({ receitas: acc.receitas + l.receitas, despesas: acc.despesas + l.despesas }),
      { receitas: semUnidade.receitas, despesas: semUnidade.despesas }
    );
    total.saldo = total.receitas - total.despesas;

    res.json({ caixas: linhas, semUnidade, total });
  } catch (err) {
    next(err);
  }
}

// Contas a pagar ainda não pagas com vencimento dentro de [inicio, fim], incluindo os meses
// projetados de contas fixas mensais (que não existem como linha no banco até serem pagos).
async function contasPagarEmAbertoNoPeriodo(inicio, fim) {
  const mesesStr = [];
  for (let d = new Date(inicio.getFullYear(), inicio.getMonth(), 1); d <= fim; d.setMonth(d.getMonth() + 1)) {
    mesesStr.push(chaveMes(d));
  }
  const porMes = await Promise.all(
    mesesStr.map((mesStr) =>
      listarContasComRecorrencia({ delegate: prisma.contaPagar, include: { caixa: true }, mesStr })
    )
  );
  return porMes
    .flat()
    .filter((c) => !c.pago && new Date(c.vencimento) >= inicio && new Date(c.vencimento) <= fim);
}

async function relatorioPeriodo(req, res, next) {
  try {
    const { de, ate } = req.query;
    if (!de || !ate) {
      return res.status(400).json({ error: 'de e ate são obrigatórios' });
    }
    const inicio = new Date(de);
    const fim = new Date(ate);
    fim.setHours(23, 59, 59, 999);

    const [contasPagas, contasEmAberto, vendasConfirmadas, itensVendidos] = await Promise.all([
      prisma.contaPagar.findMany({
        where: { pago: true, pagoEm: { gte: inicio, lte: fim } },
        include: { caixa: true },
        orderBy: { pagoEm: 'asc' },
      }),
      contasPagarEmAbertoNoPeriodo(inicio, fim),
      prisma.venda.aggregate({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: inicio, lte: fim } },
        _sum: { total: true },
      }),
      // Custo dos produtos vendidos, travado em cada venda (ItemVenda.custoUnit, não o
      // Produto.precoCusto atual — um recebimento com preço novo não deve mudar
      // retroativamente vendas já feitas) — o lucro desconta isso além das despesas
      // operacionais, senão o número não reflete o que realmente sobrou.
      prisma.itemVenda.findMany({
        where: { venda: { status: 'CONFIRMADA', confirmadaEm: { gte: inicio, lte: fim } } },
        select: {
          quantidade: true,
          quantidadeGraoPorNivel: true,
          custoUnit: true,
        },
      }),
    ]);

    const despesasTotal = contasPagas.reduce((soma, c) => soma + Number(c.valor), 0);
    const despesasEmAbertoTotal = contasEmAberto.reduce((soma, c) => soma + Number(c.valor), 0);
    const custoProdutosTotal = custoTotalDosItens(itensVendidos);
    const faturamento = Number(vendasConfirmadas._sum.total || 0);

    // Lucro é só a margem dos itens vendidos (faturamento - custo dos produtos) — despesas
    // pagas ficam à parte em `despesasTotal`; `saldoFinal` é o que sobra depois delas.
    const lucro = faturamento - custoProdutosTotal;
    res.json({
      contasPagas,
      contasEmAberto,
      faturamento,
      despesasTotal,
      despesasEmAbertoTotal,
      custoProdutosTotal,
      lucro,
      saldoFinal: lucro - despesasTotal,
    });
  } catch (err) {
    next(err);
  }
}

const SESSAO_CAIXA_INCLUDE = {
  caixa: { select: { id: true, nome: true, unidade: true } },
  usuarioAbertura: { select: { id: true, nome: true } },
  usuarioFechamento: { select: { id: true, nome: true } },
};

async function listarSessoesCaixa(req, res, next) {
  try {
    const { caixaId, usuarioId, de, ate, apenasDivergencia } = req.query;
    const where = {};
    if (caixaId) where.caixaId = Number(caixaId);
    if (usuarioId) {
      where.OR = [{ usuarioAberturaId: Number(usuarioId) }, { usuarioFechamentoId: Number(usuarioId) }];
    }
    if (de || ate) {
      where.abertaEm = {};
      if (de) where.abertaEm.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        where.abertaEm.lte = fim;
      }
    }
    if (apenasDivergencia === 'true') {
      where.divergenciaAbertura = { not: null };
      where.NOT = { divergenciaAbertura: 0 };
    }

    const sessoes = await prisma.sessaoCaixa.findMany({
      where,
      include: SESSAO_CAIXA_INCLUDE,
      orderBy: { abertaEm: 'desc' },
    });
    res.json(sessoes);
  } catch (err) {
    next(err);
  }
}

async function revisarDivergenciaSessaoCaixa(req, res, next) {
  try {
    const sessao = await prisma.sessaoCaixa.update({
      where: { id: Number(req.params.id) },
      data: { divergenciaRevisada: true },
      include: SESSAO_CAIXA_INCLUDE,
    });
    res.json(sessao);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  vendasHojePorForma,
  fornecedoresProdutos,
  fornecedoresPagamentos,
  listarContasReceber,
  criarContaReceber,
  pagarContaReceber,
  receberMesContaReceber,
  cancelarRecorrenciaContaReceber,
  listarContasPagar,
  criarContaPagar,
  lerDocumentoContaPagar,
  pagarContaPagar,
  pagarMesContaPagar,
  cancelarRecorrenciaContaPagar,
  fluxoCaixa,
  resumoPorCaixa,
  relatorioPeriodo,
  listarSessoesCaixa,
  revisarDivergenciaSessaoCaixa,
};
