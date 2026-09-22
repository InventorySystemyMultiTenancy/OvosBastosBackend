const prisma = require('../../config/db');
const { exigirCaixaAberto } = require('../caixas/sessoesCaixa.service');

const INCLUDE_PADRAO = {
  cliente: true,
  vendedor: { select: { id: true, nome: true } },
  caixa: { select: { id: true, nome: true, unidade: true, ativo: true } },
  itens: { include: { produto: true, nivelVenda: true } },
  pagamentosPointMP: { orderBy: { createdAt: 'asc' } },
};

function calcularTotal(itensComPreco, desconto, acrescimo = 0) {
  const bruto = itensComPreco.reduce((soma, i) => soma + i.quantidade * Number(i.precoUnit), 0);
  return Math.max(bruto - Number(desconto || 0) + Number(acrescimo || 0), 0);
}

// Quantidade no grão-base do estoque do Produto (Produto.quantidade/EstoqueCaixa — o mesmo
// grão pra qualquer nível de venda) que um item de venda realmente tira: quantidade de linhas
// vendidas × quantos grãos-base 1 unidade daquele nível representa (snapshot travado na venda
// em ItemVenda.quantidadeGraoPorNivel — ver NivelVendaProduto no schema).
function unidadesBaseDoItem(item) {
  return item.quantidade * item.quantidadeGraoPorNivel;
}

function validarTipoCartaoManual(formaPagamento, tipoCartaoManual) {
  if (tipoCartaoManual === undefined || tipoCartaoManual === null || tipoCartaoManual === '') return null;
  if (formaPagamento !== 'CARTAO') {
    throw Object.assign(new Error('tipoCartaoManual só é aceito com formaPagamento "CARTAO"'), { status: 400 });
  }
  if (!['CREDITO', 'DEBITO'].includes(tipoCartaoManual)) {
    throw Object.assign(new Error('tipoCartaoManual deve ser "CREDITO" ou "DEBITO"'), { status: 400 });
  }
  return tipoCartaoManual;
}

async function processarCheckout({ clienteId, vendedorId, caixaId, itens, formaPagamento, vencimento, desconto = 0, acrescimo = 0, valorDinheiro, tipoCartaoManual, origemMotivo }) {
  if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
    throw Object.assign(new Error('clienteId e ao menos um item são obrigatórios'), { status: 400 });
  }
  if (!formaPagamento) {
    throw Object.assign(new Error('formaPagamento é obrigatória'), { status: 400 });
  }

  // "MAQUININHA" é um sinalizador do checkout, não um valor válido do enum FormaPagamento:
  // a venda nasce como ORÇAMENTO (sem baixar estoque) e só é confirmada — com formaPagamento
  // "CARTAO" — quando o Mercado Pago aprova o pagamento (ver mercadopago.service.aplicarStatusIntent).
  // Uma venda paga na maquininha por fora do sistema (sem integração, ex: internet caiu) já
  // chega aqui como formaPagamento "CARTAO" direto — confirma na hora, igual "DINHEIRO".
  const viaMaquininha = formaPagamento === 'MAQUININHA';
  const tipoCartaoManualValidado = validarTipoCartaoManual(formaPagamento, tipoCartaoManual);

  // Pagamento dividido: uma parte sai em dinheiro na hora, o restante vai pra maquininha.
  // Só faz sentido junto com MAQUININHA — o valor em dinheiro puro já é a forma "DINHEIRO".
  const valorDinheiroNum = valorDinheiro !== undefined && valorDinheiro !== null ? Number(valorDinheiro) : null;
  if (valorDinheiroNum !== null) {
    if (!viaMaquininha) {
      throw Object.assign(new Error('valorDinheiro só é aceito com pagamento na maquininha'), { status: 400 });
    }
    if (valorDinheiroNum <= 0) {
      throw Object.assign(new Error('valorDinheiro deve ser maior que zero'), { status: 400 });
    }
  }

  if (caixaId) {
    const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) } });
    if (!caixa || !caixa.ativo) {
      throw Object.assign(new Error('Caixa/unidade inválido'), { status: 400 });
    }
    await exigirCaixaAberto(caixaId);
  } else if (viaMaquininha) {
    throw Object.assign(new Error('Selecione um caixa para cobrar na maquininha'), { status: 400 });
  }

  const produtos = await prisma.produto.findMany({
    where: { id: { in: itens.map((i) => Number(i.produtoId)) } },
  });

  const nivelIds = itens.map((i) => Number(i.nivelVendaId)).filter(Boolean);
  const niveis = nivelIds.length
    ? await prisma.nivelVendaProduto.findMany({ where: { id: { in: nivelIds } } })
    : [];

  // Com caixa selecionada, a unidade só pode vender o que tem alocado a ela (EstoqueCaixa).
  // Sem caixa (ex.: catálogo online), continua vendendo do pool central (Produto.quantidade).
  const estoquesCaixa = caixaId
    ? await prisma.estoqueCaixa.findMany({
        where: { caixaId: Number(caixaId), produtoId: { in: itens.map((i) => Number(i.produtoId)) } },
      })
    : [];
  const mapaEstoqueCaixa = new Map(estoquesCaixa.map((e) => [e.produtoId, e.quantidade]));

  const itensComPreco = itens.map((i) => {
    const produto = produtos.find((p) => p.id === Number(i.produtoId));
    if (!produto || !produto.ativo) {
      throw Object.assign(new Error(`Produto ${i.produtoId} não encontrado`), { status: 400 });
    }
    const quantidade = Number(i.quantidade);
    if (!quantidade || quantidade <= 0) {
      throw Object.assign(new Error(`Quantidade inválida para "${produto.nome}"`), { status: 400 });
    }

    // Todo item vende um nível cadastrado do produto (Unidade/Dúzia/Bandeja/Caixa — ver
    // NivelVendaProduto), todos descontando do mesmo estoque (Produto.quantidade/
    // EstoqueCaixa) — só muda quantos grãos-base 1 unidade daquele nível representa.
    const nivel = niveis.find((n) => n.id === Number(i.nivelVendaId) && n.produtoId === produto.id);
    if (!nivel || !nivel.ativo) {
      throw Object.assign(new Error(`Nível de venda de "${produto.nome}" não encontrado`), { status: 400 });
    }
    const precoUnit = nivel.preco;
    const quantidadeGraoPorNivel = nivel.quantidadeGrao;

    const item = { quantidade, quantidadeGraoPorNivel };
    const bandejasNecessarias = unidadesBaseDoItem(item);

    const disponivel = caixaId ? mapaEstoqueCaixa.get(produto.id) || 0 : produto.quantidade;
    if (disponivel < bandejasNecessarias) {
      throw Object.assign(
        new Error(`Estoque insuficiente para "${produto.nome}"${caixaId ? ' nesta unidade' : ''}`),
        { status: 400 }
      );
    }
    return {
      produtoId: produto.id,
      quantidade,
      precoUnit,
      nivelVendaId: nivel.id,
      quantidadeGraoPorNivel,
      // Trava o custo (por grão-base) que valia agora — editar Produto.precoCusto depois
      // (ex: num recebimento com preço novo do fornecedor) não deve mudar retroativamente
      // o custo desta venda.
      custoUnit: produto.precoCusto,
      nome: produto.nome,
    };
  });

  const total = calcularTotal(itensComPreco, desconto, acrescimo);

  if (valorDinheiroNum !== null && valorDinheiroNum >= total) {
    throw Object.assign(new Error('valorDinheiro deve ser menor que o total (o restante vai pra maquininha)'), { status: 400 });
  }

  if (formaPagamento === 'FIADO') {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    const devedorAtual = await prisma.contaReceber.aggregate({
      where: { clienteId, pago: false },
      _sum: { valor: true },
    });
    const saldoDevedor = Number(devedorAtual._sum.valor || 0);
    const limite = Number(cliente.limiteCredito);
    if (saldoDevedor + total > limite) {
      throw Object.assign(new Error('Limite de crédito do cliente excedido'), { status: 400 });
    }
  }

  const venda = await prisma.$transaction(async (tx) => {
    const novaVenda = await tx.venda.create({
      data: {
        clienteId,
        vendedorId: vendedorId || null,
        caixaId: caixaId ? Number(caixaId) : null,
        status: viaMaquininha ? 'ORCAMENTO' : 'CONFIRMADA',
        formaPagamento: viaMaquininha ? null : formaPagamento,
        valorDinheiro: valorDinheiroNum,
        tipoCartaoManual: tipoCartaoManualValidado,
        desconto,
        acrescimo,
        total,
        confirmadaEm: viaMaquininha ? null : new Date(),
        itens: {
          create: itensComPreco.map(({ produtoId, quantidade, precoUnit, nivelVendaId, quantidadeGraoPorNivel, custoUnit }) => ({
            produtoId,
            quantidade,
            precoUnit,
            nivelVendaId,
            quantidadeGraoPorNivel,
            custoUnit,
          })),
        },
      },
    });

    if (!viaMaquininha) {
      for (const item of itensComPreco) {
        const bandejas = unidadesBaseDoItem(item);
        if (caixaId) {
          await tx.estoqueCaixa.update({
            where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: Number(caixaId) } },
            data: { quantidade: { decrement: bandejas } },
          });
        } else {
          await tx.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: bandejas } } });
        }
        await tx.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: caixaId ? Number(caixaId) : null,
            tipo: 'SAIDA',
            quantidade: bandejas,
            motivo: origemMotivo ? `${origemMotivo} #${novaVenda.id}` : `Venda #${novaVenda.id}`,
          },
        });
      }
    }

    if (formaPagamento === 'FIADO') {
      await tx.contaReceber.create({
        data: {
          clienteId,
          vendaId: novaVenda.id,
          caixaId: caixaId ? Number(caixaId) : null,
          valor: total,
          vencimento: vencimento ? new Date(vencimento) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    return novaVenda;
  });

  return prisma.venda.findUnique({ where: { id: venda.id }, include: INCLUDE_PADRAO });
}

async function confirmarVenda(vendaId, { formaPagamento, vencimento, tipoCartaoManual }) {
  const id = Number(vendaId);
  if (!formaPagamento) {
    throw Object.assign(new Error('formaPagamento é obrigatória'), { status: 400 });
  }
  const tipoCartaoManualValidado = validarTipoCartaoManual(formaPagamento, tipoCartaoManual);

  const venda = await prisma.venda.findUnique({ where: { id }, include: { itens: true, cliente: true } });
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada'), { status: 404 });
  }
  if (venda.status !== 'ORCAMENTO') {
    throw Object.assign(new Error('Somente orçamentos podem ser confirmados'), { status: 400 });
  }

  if (venda.caixaId) {
    await exigirCaixaAberto(venda.caixaId);
  }

  const mapaProdutos = new Map();
  for (const item of venda.itens) {
    const produto = await prisma.produto.findUnique({ where: { id: item.produtoId } });
    mapaProdutos.set(item.produtoId, produto);
    const disponivel = venda.caixaId
      ? (
          await prisma.estoqueCaixa.findUnique({
            where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
          })
        )?.quantidade || 0
      : produto.quantidade;
    if (disponivel < unidadesBaseDoItem(item)) {
      throw Object.assign(
        new Error(`Estoque insuficiente para o produto "${produto.nome}"${venda.caixaId ? ' nesta unidade' : ''}`),
        { status: 400 }
      );
    }
  }

  if (formaPagamento === 'FIADO') {
    const devedorAtual = await prisma.contaReceber.aggregate({
      where: { clienteId: venda.clienteId, pago: false },
      _sum: { valor: true },
    });
    const saldoDevedor = Number(devedorAtual._sum.valor || 0);
    const limite = Number(venda.cliente.limiteCredito);
    if (saldoDevedor + Number(venda.total) > limite) {
      throw Object.assign(new Error('Limite de crédito do cliente excedido'), { status: 400 });
    }
  }

  const operacoes = [
    prisma.venda.update({
      where: { id },
      data: { status: 'CONFIRMADA', formaPagamento, tipoCartaoManual: tipoCartaoManualValidado, confirmadaEm: new Date() },
    }),
    ...venda.itens.flatMap((item) => {
      const bandejas = unidadesBaseDoItem(item);
      return [
        venda.caixaId
          ? prisma.estoqueCaixa.update({
              where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
              data: { quantidade: { decrement: bandejas } },
            })
          : prisma.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: bandejas } } }),
        prisma.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: venda.caixaId || null,
            tipo: 'SAIDA',
            quantidade: bandejas,
            motivo: `Venda #${id}`,
          },
        }),
      ];
    }),
  ];

  if (formaPagamento === 'FIADO') {
    operacoes.push(
      prisma.contaReceber.create({
        data: {
          clienteId: venda.clienteId,
          vendaId: id,
          caixaId: venda.caixaId,
          valor: venda.total,
          vencimento: vencimento ? new Date(vencimento) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    );
  }

  await prisma.$transaction(operacoes);

  return prisma.venda.findUnique({ where: { id }, include: INCLUDE_PADRAO });
}

// Desfaz uma venda já CONFIRMADA: devolve o estoque baixado (pro EstoqueCaixa da unidade,
// ou pro pool central se a venda não tinha caixa), apaga a conta a receber se era fiado
// ainda não pago, e volta a venda pra ORCAMENTO sem forma de pagamento — a partir daí ela
// reaparece na lista com os mesmos botões "Confirmar"/"Cancelar" de qualquer orçamento, então
// tanto "reabrir pra trocar a forma de pagamento" quanto "apagar a venda" usam esse mesmo
// caminho (reabrir e, se for o caso, cancelar o orçamento resultante).
async function reabrirVenda(vendaId) {
  const id = Number(vendaId);
  const venda = await prisma.venda.findUnique({ where: { id }, include: { itens: true, contaReceber: true } });
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada'), { status: 404 });
  }
  if (venda.status !== 'CONFIRMADA') {
    throw Object.assign(new Error('Somente vendas confirmadas podem ser reabertas'), { status: 400 });
  }
  if (venda.contaReceber && venda.contaReceber.pago) {
    throw Object.assign(
      new Error('Esta venda tem uma conta a receber (fiado) já paga — estorne o pagamento no Financeiro antes de reabrir'),
      { status: 400 }
    );
  }

  const operacoes = [
    ...venda.itens.flatMap((item) => {
      const bandejas = unidadesBaseDoItem(item);
      return [
        venda.caixaId
          ? prisma.estoqueCaixa.upsert({
              where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
              create: { produtoId: item.produtoId, caixaId: venda.caixaId, quantidade: bandejas },
              update: { quantidade: { increment: bandejas } },
            })
          : prisma.produto.update({ where: { id: item.produtoId }, data: { quantidade: { increment: bandejas } } }),
        prisma.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: venda.caixaId || null,
            tipo: 'ENTRADA',
            quantidade: bandejas,
            motivo: `Reabertura venda #${id}`,
          },
        }),
      ];
    }),
    prisma.venda.update({
      where: { id },
      data: { status: 'ORCAMENTO', formaPagamento: null, valorDinheiro: null, tipoCartaoManual: null, confirmadaEm: null },
    }),
  ];

  if (venda.contaReceber) {
    operacoes.push(prisma.contaReceber.delete({ where: { id: venda.contaReceber.id } }));
  }

  await prisma.$transaction(operacoes);

  return prisma.venda.findUnique({ where: { id }, include: INCLUDE_PADRAO });
}

const FORMAS_PAGAMENTO_SIMPLES = ['PIX', 'DINHEIRO', 'BOLETO', 'FIADO'];

// Quebra o faturamento confirmado num intervalo por forma de pagamento — cartão sai
// separado em crédito/débito usando o tipo real que a maquininha reportou
// (PagamentoPointMP.tipoPagamentoDetectado) ou o que o operador escolheu na hora de lançar
// uma venda paga na maquininha por fora do sistema (Venda.tipoCartaoManual); só cai em
// "outro" quando nenhum dos dois existe. Usado tanto no fechamento do dia (dashboard) quanto
// no fechamento de uma sessão de caixa específica (sessoesCaixa.controller).
async function resumoPorFormaPagamento({ caixaId, desde, ate } = {}) {
  const where = { status: 'CONFIRMADA', confirmadaEm: { gte: desde } };
  if (ate) where.confirmadaEm.lte = ate;
  if (caixaId) where.caixaId = Number(caixaId);

  const vendas = await prisma.venda.findMany({
    where,
    select: {
      total: true,
      formaPagamento: true,
      valorDinheiro: true,
      tipoCartaoManual: true,
      pagamentosPointMP: { where: { status: 'APROVADO' }, select: { valor: true, tipoPagamentoDetectado: true } },
    },
  });

  const totais = { PIX: 0, DINHEIRO: 0, CARTAO_CREDITO: 0, CARTAO_DEBITO: 0, CARTAO_OUTRO: 0, BOLETO: 0, FIADO: 0 };

  vendas.forEach((v) => {
    const total = Number(v.total);
    const dinheiro = Number(v.valorDinheiro || 0);
    if (dinheiro > 0) totais.DINHEIRO += dinheiro;

    if (v.formaPagamento === 'CARTAO') {
      if (v.pagamentosPointMP.length > 0) {
        v.pagamentosPointMP.forEach((p) => {
          const valor = Number(p.valor);
          if (p.tipoPagamentoDetectado === 'credit_card') totais.CARTAO_CREDITO += valor;
          else if (p.tipoPagamentoDetectado === 'debit_card') totais.CARTAO_DEBITO += valor;
          else totais.CARTAO_OUTRO += valor;
        });
      } else if (v.tipoCartaoManual === 'CREDITO') {
        totais.CARTAO_CREDITO += total - dinheiro;
      } else if (v.tipoCartaoManual === 'DEBITO') {
        totais.CARTAO_DEBITO += total - dinheiro;
      } else {
        totais.CARTAO_OUTRO += total - dinheiro;
      }
    } else if (FORMAS_PAGAMENTO_SIMPLES.includes(v.formaPagamento)) {
      totais[v.formaPagamento] += total;
    }
  });

  const faturamento = vendas.reduce((soma, v) => soma + Number(v.total), 0);
  return { faturamento, quantidadeVendas: vendas.length, porFormaPagamento: totais };
}

// Apaga a venda de vez (linha some do banco). Só permitido pra ORCAMENTO/CANCELADA — uma
// venda CONFIRMADA já baixou estoque e pode ter conta a receber/fechamento associado, então
// precisa passar por reabrirVenda antes (devolve estoque e apaga a conta a receber em aberto)
// pra só então poder ser excluída. PagamentoPointMP cai junto (onDelete: Cascade no schema).
async function excluirVenda(vendaId) {
  const id = Number(vendaId);
  const venda = await prisma.venda.findUnique({ where: { id }, include: { contaReceber: true, pagamentosPointMP: true } });
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada'), { status: 404 });
  }
  if (venda.status === 'CONFIRMADA') {
    throw Object.assign(
      new Error('Vendas confirmadas não podem ser excluídas diretamente — reabra a venda antes (devolve o estoque) e depois cancele o orçamento resultante'),
      { status: 400 }
    );
  }
  if (venda.contaReceber) {
    throw Object.assign(new Error('Esta venda tem uma conta a receber associada e não pode ser excluída'), { status: 400 });
  }
  const cobrancaAprovada = venda.pagamentosPointMP.find((p) => p.status === 'APROVADO');
  if (cobrancaAprovada) {
    throw Object.assign(
      new Error('Esta venda tem um pagamento aprovado na maquininha e não pode ser excluída'),
      { status: 409 }
    );
  }
  await prisma.venda.delete({ where: { id } });
}

module.exports = {
  INCLUDE_PADRAO,
  calcularTotal,
  processarCheckout,
  confirmarVenda,
  reabrirVenda,
  excluirVenda,
  resumoPorFormaPagamento,
};
