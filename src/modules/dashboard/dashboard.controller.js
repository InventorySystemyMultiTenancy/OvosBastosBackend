const prisma = require('../../config/db');

async function resumo(req, res, next) {
  try {
    const inicioHoje = new Date();
    inicioHoje.setHours(0, 0, 0, 0);
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);

    const [faturamentoHoje, pedidosHoje, clientesComPedidoNoMes, bandejas, produtos] = await Promise.all([
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
    ]);

    const bandejasPendentes = bandejas.reduce((soma, b) => soma + (b.emprestadas - b.devolvidas), 0);
    const estoqueDisponivel = produtos.reduce((soma, p) => soma + p.quantidade, 0);
    const produtosEstoqueBaixo = produtos.filter((p) => p.quantidade <= p.estoqueMinimo).length;

    res.json({
      faturamentoHoje: Number(faturamentoHoje._sum.total || 0),
      pedidosHoje,
      clientesComPedidoNoMes: clientesComPedidoNoMes.length,
      bandejasPendentes,
      estoqueDisponivel,
      produtosEstoqueBaixo,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { resumo };
