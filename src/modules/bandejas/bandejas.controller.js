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
    const { quantidade } = req.body;
    if (!quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'quantidade (> 0) é obrigatória' });
    }

    const [bandeja] = await prisma.$transaction([
      prisma.bandejaCliente.update({
        where: { clienteId },
        data: { devolvidas: { increment: Number(quantidade) } },
      }),
      prisma.movimentacaoBandeja.create({
        data: { clienteId, tipo: 'DEVOLUCAO', quantidade: Number(quantidade) },
      }),
    ]);

    res.status(201).json(comSaldo(bandeja));
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

module.exports = { listar, emprestimo, devolucao, historico };
