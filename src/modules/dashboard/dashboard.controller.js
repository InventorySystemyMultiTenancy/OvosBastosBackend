const prisma = require('../../config/db');

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

    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const desde = new Date();
    desde.setDate(desde.getDate() - (dias - 1));
    desde.setHours(0, 0, 0, 0);

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
        select: { id: true, total: true, confirmadaEm: true, clienteId: true, cliente: { select: { nome: true } } },
      }),
      prisma.itemVenda.findMany({
        where: { venda: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } } },
        select: { quantidade: true, precoUnit: true, produtoId: true, produto: { select: { nome: true } } },
      }),
      prisma.contaReceber.findMany({
        where: { pago: false },
        include: { cliente: true },
        orderBy: { vencimento: 'asc' },
      }),
    ]);

    const bandejasPendentes = bandejas.reduce((soma, b) => soma + (b.emprestadas - b.devolvidas), 0);
    const estoqueDisponivel = produtos.reduce((soma, p) => soma + p.quantidade, 0);
    const produtosEstoqueBaixo = produtos.filter((p) => p.quantidade <= p.estoqueMinimo).length;

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
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { resumo };
