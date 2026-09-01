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

// Saída do pool central é sempre uma distribuição para uma unidade — não existe mais
// "saída sem destino". Do ponto de vista da unidade é uma ENTRADA em EstoqueCaixa, mesmo
// padrão já usado em recebimentos.service.js:distribuir(); a diferença é que aqui não
// depende de um Recebimento em andamento, então pode ser repetida quantas vezes o admin
// quiser pra redistribuir o pool não distribuído entre as unidades.
async function saida(req, res, next) {
  try {
    const { produtoId, caixaId, quantidade, motivo } = req.body;
    if (!produtoId || !caixaId || !quantidade || quantidade <= 0) {
      return res.status(400).json({ error: 'produtoId, caixaId e quantidade (> 0) são obrigatórios' });
    }

    const [produtoAtual, caixa] = await Promise.all([
      prisma.produto.findUnique({ where: { id: Number(produtoId) } }),
      prisma.caixa.findUnique({ where: { id: Number(caixaId) } }),
    ]);
    if (!produtoAtual) return res.status(404).json({ error: 'Produto não encontrado' });
    if (!caixa || !caixa.ativo) return res.status(404).json({ error: 'Unidade não encontrada ou inativa' });
    if (produtoAtual.quantidade < Number(quantidade)) {
      return res.status(400).json({ error: 'Estoque não distribuído insuficiente para essa saída' });
    }

    const [produto] = await prisma.$transaction([
      prisma.produto.update({
        where: { id: Number(produtoId) },
        data: { quantidade: { decrement: Number(quantidade) } },
      }),
      prisma.estoqueCaixa.upsert({
        where: { produtoId_caixaId: { produtoId: Number(produtoId), caixaId: Number(caixaId) } },
        create: { produtoId: Number(produtoId), caixaId: Number(caixaId), quantidade: Number(quantidade) },
        update: { quantidade: { increment: Number(quantidade) } },
      }),
      prisma.movimentacaoEstoque.create({
        data: {
          produtoId: Number(produtoId),
          caixaId: Number(caixaId),
          tipo: 'ENTRADA',
          quantidade: Number(quantidade),
          motivo: motivo || `Distribuição manual para ${caixa.nome}`,
        },
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
    const [produtos, estoques] = await Promise.all([
      prisma.produto.findMany({ where: { ativo: true } }),
      prisma.estoqueCaixa.findMany({ where: { caixa: { ativo: true } } }),
    ]);
    // Total físico = pool central (recebido, ainda não distribuído) + soma distribuída
    // às unidades ativas. Comparar só o pool central geraria falso "estoque baixo" em
    // todo produto totalmente distribuído (o pool central zera nesse caso, de propósito).
    const mapaDistribuido = {};
    estoques.forEach((e) => {
      mapaDistribuido[e.produtoId] = (mapaDistribuido[e.produtoId] || 0) + e.quantidade;
    });
    const estoqueBaixo = produtos.filter((p) => p.quantidade + (mapaDistribuido[p.id] || 0) <= p.estoqueMinimo);

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

async function matriz(req, res, next) {
  try {
    const [produtos, caixas, estoques] = await Promise.all([
      prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
      prisma.caixa.findMany({ where: { ativo: true }, orderBy: { id: 'asc' } }),
      prisma.estoqueCaixa.findMany(),
    ]);
    const celulas = {};
    estoques.forEach((e) => {
      celulas[`${e.produtoId}-${e.caixaId}`] = e.quantidade;
    });
    res.json({
      produtos: produtos.map((p) => ({
        id: p.id,
        nome: p.nome,
        unidade: p.unidade,
        naoDistribuido: p.quantidade,
        estoqueMinimo: p.estoqueMinimo,
      })),
      caixas: caixas.map((c) => ({ id: c.id, nome: c.nome, unidade: c.unidade })),
      celulas,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { entrada, saida, historico, alertas, matriz };
