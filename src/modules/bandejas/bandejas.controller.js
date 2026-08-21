const prisma = require('../../config/db');

function comSaldo(bandeja) {
  return { ...bandeja, saldo: bandeja.emprestadas - bandeja.devolvidas };
}

async function listar(req, res, next) {
  try {
    const bandejas = await prisma.bandejaCliente.findMany({
      include: { cliente: true },
      orderBy: { cliente: { nome: 'asc' } },
    });
    res.json(bandejas.map(comSaldo));
  } catch (err) {
    next(err);
  }
}

async function emprestimo(req, res, next) {
  try {
    const clienteId = Number(req.params.clienteId);
    const { quantidade } = req.body;
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'quantidade (> 0) é obrigatória' });
    }

    const [bandeja] = await prisma.$transaction([
      prisma.bandejaCliente.update({
        where: { clienteId },
        data: { emprestadas: { increment: Number(quantidade) } },
      }),
      prisma.movimentacaoBandeja.create({
        data: { clienteId, tipo: 'EMPRESTIMO', quantidade: Number(quantidade) },
      }),
    ]);

    res.status(201).json(comSaldo(bandeja));
  } catch (err) {
    next(err);
  }
}

async function devolucao(req, res, next) {
  try {
    const clienteId = Number(req.params.clienteId);
    const { quantidade, valor } = req.body;
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'quantidade (> 0) é obrigatória' });
    }

    const valorCobrado = Number(valor) || 0;
    if (valorCobrado < 0) {
      return res.status(400).json({ error: 'valor não pode ser negativo' });
    }

    let clienteNome = null;
    if (valorCobrado > 0) {
      const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
      if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
      clienteNome = cliente.nome;
    }

    const [bandeja] = await prisma.$transaction([
      prisma.bandejaCliente.update({
        where: { clienteId },
        data: { devolvidas: { increment: Number(quantidade) } },
      }),
      prisma.movimentacaoBandeja.create({
        data: { clienteId, tipo: 'DEVOLUCAO', quantidade: Number(quantidade), valor: valorCobrado > 0 ? valorCobrado : null },
      }),
      // A revenda já entra como despesa paga, pra descontar do lucro líquido junto com o resto.
      ...(valorCobrado > 0
        ? [
            prisma.contaPagar.create({
              data: {
                descricao: `Revenda de bandejas — ${clienteNome} (${quantidade} un.)`,
                valor: valorCobrado,
                vencimento: new Date(),
                pago: true,
                pagoEm: new Date(),
              },
            }),
          ]
        : []),
    ]);

    res.status(201).json(comSaldo(bandeja));
  } catch (err) {
    next(err);
  }
}

async function revendas(req, res, next) {
  try {
    const movimentacoes = await prisma.movimentacaoBandeja.findMany({
      where: { tipo: 'DEVOLUCAO', valor: { gt: 0 } },
      include: { cliente: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(movimentacoes);
  } catch (err) {
    next(err);
  }
}

async function historico(req, res, next) {
  try {
    const clienteId = Number(req.params.clienteId);
    const movimentacoes = await prisma.movimentacaoBandeja.findMany({
      where: { clienteId },
      orderBy: { createdAt: 'desc' },
    });
    res.json(movimentacoes);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, emprestimo, devolucao, historico, revendas };
