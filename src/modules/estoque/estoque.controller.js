const prisma = require('../../config/db');

async function entrada(req, res, next) {
  try {
    const { produtoId, quantidade, validade, motivo } = req.body;
    if (!produtoId || !quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'produtoId e quantidade (> 0) são obrigatórios' });
    }

    const [produto] = await prisma.$transaction([
      prisma.produto.update({
        where: { id: Number(produtoId) },
        data: { quantidade: { increment: Number(quantidade) } },
      }),
      prisma.movimentacaoEstoque.create({
        data: { produtoId: Number(produtoId), tipo: 'ENTRADA', quantidade: Number(quantidade), motivo },
      }),
      ...(validade
        ? [prisma.lote.create({ data: { produtoId: Number(produtoId), quantidade: Number(quantidade), validade: new Date(validade) } })]
        : []),
    ]);

    res.status(201).json(produto);
  } catch (err) {
    next(err);
  }
}

async function saida(req, res, next) {
  try {
    const { produtoId, quantidade, motivo } = req.body;
    if (!produtoId || !quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'produtoId e quantidade (> 0) são obrigatórios' });
    }

    const produtoAtual = await prisma.produto.findUnique({ where: { id: Number(produtoId) } });
    if (!produtoAtual) return res.status(404).json({ error: 'Produto não encontrado' });
    if (produtoAtual.quantidade < Number(quantidade)) {
      return res.status(400).json({ error: 'Estoque insuficiente para essa saída' });
    }

    const [produto] = await prisma.$transaction([
      prisma.produto.update({
        where: { id: Number(produtoId) },
        data: { quantidade: { decrement: Number(quantidade) } },
      }),
      prisma.movimentacaoEstoque.create({
        data: { produtoId: Number(produtoId), tipo: 'SAIDA', quantidade: Number(quantidade), motivo },
      }),
    ]);

    res.status(201).json(produto);
  } catch (err) {
    next(err);
  }
}

async function historico(req, res, next) {
  try {
    const where = req.query.produtoId ? { produtoId: Number(req.query.produtoId) } : {};
    const movimentacoes = await prisma.movimentacaoEstoque.findMany({
      where,
      include: { produto: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(movimentacoes);
  } catch (err) {
    next(err);
  }
}

async function alertas(req, res, next) {
  try {
    const produtos = await prisma.produto.findMany({ where: { ativo: true } });
    const estoqueBaixo = produtos.filter((p) => p.quantidade <= p.estoqueMinimo);

    const emSeteDias = new Date();
    emSeteDias.setDate(emSeteDias.getDate() + 7);
    const validadeProxima = await prisma.lote.findMany({
      where: { validade: { lte: emSeteDias }, quantidade: { gt: 0 } },
      include: { produto: true },
      orderBy: { validade: 'asc' },
    });

    res.json({ estoqueBaixo, validadeProxima });
  } catch (err) {
    next(err);
  }
}

module.exports = { entrada, saida, historico, alertas };
