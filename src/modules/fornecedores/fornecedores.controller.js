const prisma = require('../../config/db');

async function listar(req, res, next) {
  try {
    const fornecedores = await prisma.fornecedor.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
    });
    res.json(fornecedores);
  } catch (err) {
    next(err);
  }
}

async function obter(req, res, next) {
  try {
    const fornecedor = await prisma.fornecedor.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        recebimentos: { orderBy: { createdAt: 'desc' }, take: 20, include: { itens: { include: { produto: true } } } },
      },
    });
    if (!fornecedor) return res.status(404).json({ error: 'Fornecedor não encontrado' });
    res.json(fornecedor);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, documento, telefone, email, endereco, cidade } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const fornecedor = await prisma.fornecedor.create({
      data: { nome, documento, telefone, email, endereco, cidade },
    });
    res.status(201).json(fornecedor);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { nome, documento, telefone, email, endereco, cidade } = req.body;
    const fornecedor = await prisma.fornecedor.update({
      where: { id: Number(req.params.id) },
      data: { nome, documento, telefone, email, endereco, cidade },
    });
    res.json(fornecedor);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    await prisma.fornecedor.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function listarPrecos(req, res, next) {
  try {
    const fornecedorId = Number(req.params.id);
    const [produtos, precos] = await Promise.all([
      prisma.produto.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }),
      prisma.precoFornecedor.findMany({ where: { fornecedorId } }),
    ]);
    const mapaPrecos = new Map(precos.map((p) => [p.produtoId, p.precoUnitario]));
    res.json(
      produtos.map((p) => ({
        produtoId: p.id,
        nome: p.nome,
        precoUnitario: mapaPrecos.has(p.id) ? mapaPrecos.get(p.id) : null,
      }))
    );
  } catch (err) {
    next(err);
  }
}

async function salvarPrecos(req, res, next) {
  try {
    const fornecedorId = Number(req.params.id);
    const { precos } = req.body;
    if (!Array.isArray(precos)) {
      return res.status(400).json({ error: 'precos é obrigatório' });
    }

    const linhas = precos
      .map((p) => ({ produtoId: Number(p.produtoId), precoUnitario: Number(p.precoUnitario) }))
      .filter((p) => p.produtoId && !Number.isNaN(p.precoUnitario) && p.precoUnitario >= 0);

    await prisma.$transaction(
      linhas.map((linha) =>
        prisma.precoFornecedor.upsert({
          where: { fornecedorId_produtoId: { fornecedorId, produtoId: linha.produtoId } },
          create: { fornecedorId, produtoId: linha.produtoId, precoUnitario: linha.precoUnitario },
          update: { precoUnitario: linha.precoUnitario },
        })
      )
    );

    const precosAtualizados = await prisma.precoFornecedor.findMany({ where: { fornecedorId } });
    res.json(precosAtualizados);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, atualizar, remover, listarPrecos, salvarPrecos };
