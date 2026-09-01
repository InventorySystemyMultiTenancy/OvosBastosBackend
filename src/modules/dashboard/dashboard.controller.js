const prisma = require('../../config/db');

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const TOP_PRODUTOS_POR_CAIXA = 5;

// null quando não há base de comparação (período anterior zerado) — o front mostra "novo"
// nesse caso em vez de uma porcentagem sem sentido.
function variacaoPct(atual, anterior) {
  if (!anterior) return atual > 0 ? null : 0;
  return ((atual - anterior) / anterior) * 100;
}

function chaveDia(data) {
  const d = new Date(data);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

async function resumo(req, res, next) {
  try {
    const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;
    const ehAdmin = req.usuario?.perfil === 'ADMIN';

    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const desde = new Date();
    desde.setDate(desde.getDate() - (dias - 1));
    desde.setHours(0, 0, 0, 0);

    // Período anterior de mesmo tamanho, usado só pra calcular a variação % mostrada
    // nos cards do topo do dashboard (ex: "+12,5% vs 30 dias anteriores").
    const desdeAnterior = new Date(desde);
    desdeAnterior.setDate(desdeAnterior.getDate() - dias);

    const agora = new Date();

    const [
      faturamentoHoje,
      pedidosHoje,
      clientesComPedidoNoMes,
      bandejas,
      produtos,
      vendasPeriodo,
      itensPeriodo,
      contasEmAberto,
      despesasPeriodo,
      estoquesCaixaAtivo,
      divergenciasCaixaAbertas,
      vendasPeriodoAnterior,
      despesasPeriodoAnterior,
    ] = await Promise.all([
      prisma.venda.aggregate({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: inicioHoje } },
        _sum: { total: true },
      }),
      prisma.venda.count({ where: { confirmadaEm: { gte: inicioHoje }, status: 'CONFIRMADA' } }),
      prisma.venda.findMany({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: inicioMes } },
        select: { clienteId: true },
        distinct: ['clienteId'],
      }),
      prisma.bandejaCliente.findMany(),
      prisma.produto.findMany({ where: { ativo: true } }),
      prisma.venda.findMany({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } },
        select: {
          id: true,
          total: true,
          confirmadaEm: true,
          clienteId: true,
          caixaId: true,
          cliente: { select: { nome: true } },
          caixa: { select: { nome: true, unidade: true } },
        },
      }),
      prisma.itemVenda.findMany({
        where: { venda: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } } },
        select: {
          quantidade: true,
          precoUnit: true,
          produtoId: true,
          produto: { select: { nome: true, precoCusto: true } },
          venda: { select: { caixaId: true, caixa: { select: { nome: true, unidade: true } } } },
        },
      }),
      prisma.contaReceber.findMany({
        where: { pago: false },
        include: { cliente: true },
        orderBy: { vencimento: 'asc' },
      }),
      // Gastos são informação financeira sensível — só buscamos e devolvemos para ADMIN.
      ehAdmin
        ? prisma.contaPagar.findMany({
            where: { pago: true, pagoEm: { gte: desde } },
            select: { valor: true, pagoEm: true, caixaId: true },
          })
        : Promise.resolve([]),
      prisma.estoqueCaixa.findMany({
        where: { caixa: { ativo: true } },
        select: { produtoId: true, caixaId: true, quantidade: true },
      }),
      // Divergências de contagem entre o fechamento de um turno e a abertura do próximo,
      // ainda não revisadas pelo admin — ver src/modules/caixas/sessoesCaixa.controller.js.
      ehAdmin
        ? prisma.sessaoCaixa.findMany({
            where: { divergenciaAbertura: { not: null }, NOT: { divergenciaAbertura: 0 }, divergenciaRevisada: false },
            orderBy: { abertaEm: 'desc' },
            take: 5,
            include: {
              caixa: { select: { nome: true, unidade: true } },
              usuarioAbertura: { select: { nome: true } },
              usuarioFechamento: { select: { nome: true } },
            },
          })
        : Promise.resolve([]),
      prisma.venda.aggregate({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: desdeAnterior, lt: desde } },
        _sum: { total: true },
        _count: true,
      }),
      ehAdmin
        ? prisma.contaPagar.aggregate({
            where: { pago: true, pagoEm: { gte: desdeAnterior, lt: desde } },
            _sum: { valor: true },
          })
        : Promise.resolve({ _sum: { valor: 0 } }),
    ]);

    const bandejasPendentes = bandejas.reduce((soma, b) => soma + (b.emprestadas - b.devolvidas), 0);

    // Estoque total = pool central (recebido, ainda não distribuído) + soma distribuída às
    // unidades ativas. Olhar só pra Produto.quantidade sub-conta o que já foi pras unidades.
    const mapaDistribuidoTotal = {};
    estoquesCaixaAtivo.forEach((e) => {
      mapaDistribuidoTotal[e.produtoId] = (mapaDistribuidoTotal[e.produtoId] || 0) + e.quantidade;
    });
    const estoqueDisponivel = produtos.reduce((soma, p) => soma + p.quantidade + (mapaDistribuidoTotal[p.id] || 0), 0);
    const produtosEstoqueBaixo = produtos.filter(
      (p) => p.quantidade + (mapaDistribuidoTotal[p.id] || 0) <= p.estoqueMinimo
    ).length;

    const mapaDias = {};
    for (let i = 0; i < dias; i++) {
      const d = new Date(desde);
      d.setDate(d.getDate() + i);
      mapaDias[chaveDia(d)] = { data: chaveDia(d), total: 0, pedidos: 0 };
    }
    vendasPeriodo.forEach((v) => {
      const chave = chaveDia(v.confirmadaEm);
      if (mapaDias[chave]) {
        mapaDias[chave].total += Number(v.total);
        mapaDias[chave].pedidos += 1;
      }
    });
    const vendasPorDia = Object.values(mapaDias);

    const faturamentoPeriodo = vendasPeriodo.reduce((soma, v) => soma + Number(v.total), 0);
    const pedidosPeriodo = vendasPeriodo.length;
    const ticketMedio = pedidosPeriodo > 0 ? faturamentoPeriodo / pedidosPeriodo : 0;

    const mapaProdutos = {};
    itensPeriodo.forEach((i) => {
      if (!mapaProdutos[i.produtoId]) {
        mapaProdutos[i.produtoId] = { produtoId: i.produtoId, nome: i.produto.nome, quantidade: 0, receita: 0 };
      }
      mapaProdutos[i.produtoId].quantidade += i.quantidade;
      mapaProdutos[i.produtoId].receita += i.quantidade * Number(i.precoUnit);
    });
    const produtosOrdenados = Object.values(mapaProdutos).sort((a, b) => b.receita - a.receita);
    const top7 = produtosOrdenados.slice(0, 7);
    const restante = produtosOrdenados.slice(7);
    const vendasPorProduto =
      restante.length > 0
        ? [
            ...top7,
            {
              produtoId: null,
              nome: 'Outros',
              quantidade: restante.reduce((s, p) => s + p.quantidade, 0),
              receita: restante.reduce((s, p) => s + p.receita, 0),
            },
          ]
        : top7;

    // Lucro por produto — venda menos custo cadastrado (Produto.precoCusto). Informação
    // financeira sensível, só pra admin (mesma regra de despesas/lucro líquido acima).
    // Produtos sem custo cadastrado entram com precoCusto/lucro null em vez de assumir 0.
    let lucroPorProduto = [];
    if (ehAdmin) {
      const mapaLucroProdutos = {};
      itensPeriodo.forEach((i) => {
        if (!mapaLucroProdutos[i.produtoId]) {
          mapaLucroProdutos[i.produtoId] = {
            produtoId: i.produtoId,
            nome: i.produto.nome,
            precoCusto: i.produto.precoCusto !== null ? Number(i.produto.precoCusto) : null,
            quantidade: 0,
            receita: 0,
          };
        }
        const item = mapaLucroProdutos[i.produtoId];
        item.quantidade += i.quantidade;
        item.receita += i.quantidade * Number(i.precoUnit);
      });
      lucroPorProduto = Object.values(mapaLucroProdutos)
        .map((p) => {
          const precoVendaMedio = p.quantidade > 0 ? p.receita / p.quantidade : 0;
          const custoTotal = p.precoCusto !== null ? p.precoCusto * p.quantidade : null;
          return {
            produtoId: p.produtoId,
            nome: p.nome,
            quantidade: p.quantidade,
            precoVenda: precoVendaMedio,
            precoCusto: p.precoCusto,
            lucroUnitario: p.precoCusto !== null ? precoVendaMedio - p.precoCusto : null,
            receita: p.receita,
            custoTotal,
            lucroTotal: custoTotal !== null ? p.receita - custoTotal : null,
          };
        })
        .sort((a, b) => (b.lucroTotal ?? -Infinity) - (a.lucroTotal ?? -Infinity));
    }

    // Produto mais vendido por unidade — mesmo agrupamento de itensPeriodo, só que por caixa.
    const mapaPorCaixaProduto = {};
    itensPeriodo.forEach((i) => {
      const chaveCaixa = i.venda.caixaId ?? 'sem-caixa';
      if (!mapaPorCaixaProduto[chaveCaixa]) {
        mapaPorCaixaProduto[chaveCaixa] = {
          caixaId: i.venda.caixaId,
          nome: i.venda.caixa ? i.venda.caixa.nome : 'Sem caixa',
          unidade: i.venda.caixa ? i.venda.caixa.unidade : null,
          produtos: {},
        };
      }
      const produtosDaCaixa = mapaPorCaixaProduto[chaveCaixa].produtos;
      if (!produtosDaCaixa[i.produtoId]) {
        produtosDaCaixa[i.produtoId] = { produtoId: i.produtoId, nome: i.produto.nome, quantidade: 0, receita: 0 };
      }
      produtosDaCaixa[i.produtoId].quantidade += i.quantidade;
      produtosDaCaixa[i.produtoId].receita += i.quantidade * Number(i.precoUnit);
    });
    const melhoresProdutosPorCaixa = Object.values(mapaPorCaixaProduto).map((c) => ({
      ...c,
      produtos: Object.values(c.produtos)
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, TOP_PRODUTOS_POR_CAIXA),
    }));

    const mapaClientes = {};
    vendasPeriodo.forEach((v) => {
      if (!mapaClientes[v.clienteId]) {
        mapaClientes[v.clienteId] = { clienteId: v.clienteId, nome: v.cliente.nome, pedidos: 0, total: 0 };
      }
      mapaClientes[v.clienteId].pedidos += 1;
      mapaClientes[v.clienteId].total += Number(v.total);
    });
    const topClientes = Object.values(mapaClientes)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const porDiaSemana = DIAS_SEMANA.map((label, diaSemana) => ({ diaSemana, label, total: 0, pedidos: 0 }));
    const porHora = Array.from({ length: 24 }, (_, hora) => ({ hora, label: `${String(hora).padStart(2, '0')}h`, total: 0, pedidos: 0 }));
    const mapaCaixas = {};

    vendasPeriodo.forEach((v) => {
      const data = new Date(v.confirmadaEm);
      porDiaSemana[data.getDay()].total += Number(v.total);
      porDiaSemana[data.getDay()].pedidos += 1;
      porHora[data.getHours()].total += Number(v.total);
      porHora[data.getHours()].pedidos += 1;

      const chave = v.caixaId ?? 'sem-caixa';
      if (!mapaCaixas[chave]) {
        mapaCaixas[chave] = {
          caixaId: v.caixaId,
          nome: v.caixa ? v.caixa.nome : 'Sem caixa',
          unidade: v.caixa ? v.caixa.unidade : null,
          receitas: 0,
          despesas: 0,
          pedidos: 0,
        };
      }
      mapaCaixas[chave].receitas += Number(v.total);
      mapaCaixas[chave].pedidos += 1;
    });

    if (ehAdmin) {
      despesasPeriodo.forEach((c) => {
        const chave = c.caixaId ?? 'sem-caixa';
        if (!mapaCaixas[chave]) {
          mapaCaixas[chave] = { caixaId: c.caixaId, nome: 'Sem caixa', unidade: null, receitas: 0, despesas: 0, pedidos: 0 };
        }
        mapaCaixas[chave].despesas += Number(c.valor);
      });
    }

    const vendasPorDiaSemana = porDiaSemana;
    const vendasPorHora = porHora;
    const melhorDiaSemana = porDiaSemana.reduce((melhor, d) => (d.total > (melhor?.total || 0) ? d : melhor), null);
    const melhorHora = porHora.reduce((melhor, h) => (h.total > (melhor?.total || 0) ? h : melhor), null);

    const rendimentoPorCaixa = Object.values(mapaCaixas)
      .map((c) => ({
        ...c,
        ticketMedio: c.pedidos > 0 ? c.receitas / c.pedidos : 0,
        ...(ehAdmin ? { saldo: c.receitas - c.despesas } : {}),
      }))
      .sort((a, b) => b.receitas - a.receitas);

    const despesasPeriodoTotal = ehAdmin ? despesasPeriodo.reduce((s, c) => s + Number(c.valor), 0) : null;
    const lucroLiquidoPeriodo = ehAdmin ? faturamentoPeriodo - despesasPeriodoTotal : null;

    const faturamentoPeriodoAnterior = Number(vendasPeriodoAnterior._sum.total || 0);
    const pedidosPeriodoAnterior = vendasPeriodoAnterior._count;
    const despesasPeriodoAnteriorTotal = ehAdmin ? Number(despesasPeriodoAnterior._sum.valor || 0) : null;
    const lucroLiquidoPeriodoAnterior = ehAdmin ? faturamentoPeriodoAnterior - despesasPeriodoAnteriorTotal : null;

    const variacaoFaturamentoPct = variacaoPct(faturamentoPeriodo, faturamentoPeriodoAnterior);
    const variacaoVendasPct = variacaoPct(pedidosPeriodo, pedidosPeriodoAnterior);
    const variacaoDespesasPct = ehAdmin ? variacaoPct(despesasPeriodoTotal, despesasPeriodoAnteriorTotal) : null;
    const variacaoLucroPct = ehAdmin ? variacaoPct(lucroLiquidoPeriodo, lucroLiquidoPeriodoAnterior) : null;

    const contasComVencimento = contasEmAberto.map((c) => ({
      id: c.id,
      cliente: c.cliente.nome,
      valor: Number(c.valor),
      vencimento: c.vencimento,
      vencida: c.vencimento < agora,
    }));
    const fiado = {
      totalEmAberto: contasComVencimento.reduce((s, c) => s + c.valor, 0),
      quantidadeEmAberto: contasComVencimento.length,
      totalVencido: contasComVencimento.filter((c) => c.vencida).reduce((s, c) => s + c.valor, 0),
      quantidadeVencida: contasComVencimento.filter((c) => c.vencida).length,
      contas: contasComVencimento.slice(0, 8),
    };

    res.json({
      faturamentoHoje: Number(faturamentoHoje._sum.total || 0),
      pedidosHoje,
      clientesComPedidoNoMes: clientesComPedidoNoMes.length,
      bandejasPendentes,
      estoqueDisponivel,
      produtosEstoqueBaixo,
      periodoDias: dias,
      faturamentoPeriodo,
      pedidosPeriodo,
      ticketMedio,
      vendasPorDia,
      vendasPorProduto,
      topClientes,
      fiado,
      rendimentoPorCaixa,
      vendasPorDiaSemana,
      vendasPorHora,
      melhorDiaSemana,
      melhorHora,
      despesasPeriodo: despesasPeriodoTotal,
      lucroLiquidoPeriodo,
      variacaoFaturamentoPct,
      variacaoVendasPct,
      variacaoDespesasPct,
      variacaoLucroPct,
      melhoresProdutosPorCaixa,
      lucroPorProduto,
      divergenciasCaixa: ehAdmin
        ? divergenciasCaixaAbertas.map((d) => ({
            id: d.id,
            caixaNome: d.caixa.nome,
            caixaUnidade: d.caixa.unidade,
            usuarioFechamento: d.usuarioFechamento?.nome || null,
            usuarioAbertura: d.usuarioAbertura.nome,
            valorFechamento: d.valorFechamento,
            valorAbertura: d.valorAbertura,
            divergencia: d.divergenciaAbertura,
            abertaEm: d.abertaEm,
          }))
        : [],
    });
  } catch (err) {
    next(err);
  }
}

// Quanto cada unidade precisa receber de volta pra voltar ao estoque que tinha no início do
// mês. Reconstruído a partir do razão de MovimentacaoEstoque (sem precisar guardar um
// snapshot): estoque no início do mês = estoque atual - entradas do mês + saídas do mês,
// já que toda mudança em EstoqueCaixa.quantidade tem uma MovimentacaoEstoque correspondente.
async function reposicaoMensal(req, res, next) {
  try {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [movimentacoesMes, estoques] = await Promise.all([
      prisma.movimentacaoEstoque.findMany({
        where: { caixaId: { not: null }, createdAt: { gte: inicioMes } },
        select: { caixaId: true, produtoId: true, tipo: true, quantidade: true },
      }),
      prisma.estoqueCaixa.findMany({
        where: { caixa: { ativo: true } },
        select: {
          caixaId: true,
          produtoId: true,
          quantidade: true,
          caixa: { select: { nome: true, unidade: true } },
          produto: { select: { nome: true } },
        },
      }),
    ]);

    const mapaMovimento = {};
    movimentacoesMes.forEach((m) => {
      const chave = `${m.caixaId}-${m.produtoId}`;
      if (!mapaMovimento[chave]) mapaMovimento[chave] = { entrada: 0, saida: 0 };
      if (m.tipo === 'ENTRADA') mapaMovimento[chave].entrada += m.quantidade;
      else mapaMovimento[chave].saida += m.quantidade;
    });

    const itens = estoques
      .map((e) => {
        const mov = mapaMovimento[`${e.caixaId}-${e.produtoId}`] || { entrada: 0, saida: 0 };
        const estoqueInicioMes = e.quantidade - mov.entrada + mov.saida;
        return {
          caixaId: e.caixaId,
          caixaNome: e.caixa.nome,
          caixaUnidade: e.caixa.unidade,
          produtoId: e.produtoId,
          produtoNome: e.produto.nome,
          estoqueInicioMes,
          estoqueAtual: e.quantidade,
          recebidoMes: mov.entrada,
          saidoMes: mov.saida,
          faltaRepor: Math.max(0, estoqueInicioMes - e.quantidade),
        };
      })
      .filter((i) => i.faltaRepor > 0)
      .sort((a, b) => b.faltaRepor - a.faltaRepor);

    res.json({ inicioMes, itens });
  } catch (err) {
    next(err);
  }
}

// Detalhe por trás do card "Lucro Líquido" do dashboard — agrupado por unidade (loja),
// não por caixa: uma unidade pode ter mais de um caixa físico, e o que importa aqui é o
// desempenho da loja como um todo, dia a dia. Só admin vê (mesma regra do resumo:
// despesas/lucro são informação financeira sensível).
async function lucroPorUnidade(req, res, next) {
  try {
    const dias = [7, 30, 90].includes(Number(req.query.dias)) ? Number(req.query.dias) : 30;

    const desde = new Date();
    desde.setDate(desde.getDate() - (dias - 1));
    desde.setHours(0, 0, 0, 0);

    const [vendasPeriodo, despesasPeriodo] = await Promise.all([
      prisma.venda.findMany({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } },
        select: { total: true, confirmadaEm: true, caixa: { select: { unidade: true } } },
      }),
      prisma.contaPagar.findMany({
        where: { pago: true, pagoEm: { gte: desde } },
        select: { valor: true, pagoEm: true, caixa: { select: { unidade: true } } },
      }),
    ]);

    const mapaUnidades = {};
    function unidadeDe(registro) {
      const unidade = registro.caixa?.unidade || 'Sem unidade';
      if (!mapaUnidades[unidade]) {
        mapaUnidades[unidade] = { unidade, faturamento: 0, despesas: 0, pedidos: 0, porDia: {} };
        for (let i = 0; i < dias; i++) {
          const d = new Date(desde);
          d.setDate(d.getDate() + i);
          mapaUnidades[unidade].porDia[chaveDia(d)] = { data: chaveDia(d), faturamento: 0, despesas: 0, pedidos: 0 };
        }
      }
      return mapaUnidades[unidade];
    }

    vendasPeriodo.forEach((v) => {
      const bloco = unidadeDe(v);
      bloco.faturamento += Number(v.total);
      bloco.pedidos += 1;
      const dia = bloco.porDia[chaveDia(v.confirmadaEm)];
      if (dia) {
        dia.faturamento += Number(v.total);
        dia.pedidos += 1;
      }
    });

    despesasPeriodo.forEach((c) => {
      const bloco = unidadeDe(c);
      bloco.despesas += Number(c.valor);
      const dia = bloco.porDia[chaveDia(c.pagoEm)];
      if (dia) dia.despesas += Number(c.valor);
    });

    const unidades = Object.values(mapaUnidades)
      .map((u) => ({
        unidade: u.unidade,
        faturamento: u.faturamento,
        despesas: u.despesas,
        lucro: u.faturamento - u.despesas,
        pedidos: u.pedidos,
        porDia: Object.values(u.porDia).map((d) => ({ ...d, lucro: d.faturamento - d.despesas })),
      }))
      .sort((a, b) => b.lucro - a.lucro);

    res.json({ periodoDias: dias, unidades });
  } catch (err) {
    next(err);
  }
}

// Quanto de cada produto está distribuído em cada unidade agora ("o que sobrou" depois de
// vendas e distribuições até aqui) — botão no topo do dashboard, mesma info da matriz de
// estoque por caixa, só que somada por unidade (uma unidade pode ter mais de um caixa).
async function estoquePorUnidade(req, res, next) {
  try {
    const estoques = await prisma.estoqueCaixa.findMany({
      where: { caixa: { ativo: true } },
      select: {
        quantidade: true,
        produto: { select: { id: true, nome: true } },
        caixa: { select: { unidade: true } },
      },
    });

    const mapaUnidades = {};
    estoques.forEach((e) => {
      const unidade = e.caixa.unidade;
      if (!mapaUnidades[unidade]) mapaUnidades[unidade] = { unidade, total: 0, produtos: {} };
      const bloco = mapaUnidades[unidade];
      if (!bloco.produtos[e.produto.id]) {
        bloco.produtos[e.produto.id] = { produtoId: e.produto.id, nome: e.produto.nome, quantidade: 0 };
      }
      bloco.produtos[e.produto.id].quantidade += e.quantidade;
      bloco.total += e.quantidade;
    });

    const unidades = Object.values(mapaUnidades)
      .map((u) => ({
        unidade: u.unidade,
        total: u.total,
        produtos: Object.values(u.produtos).sort((a, b) => b.quantidade - a.quantidade),
      }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR'));

    res.json({ unidades });
  } catch (err) {
    next(err);
  }
}

module.exports = { resumo, reposicaoMensal, lucroPorUnidade, estoquePorUnidade };
