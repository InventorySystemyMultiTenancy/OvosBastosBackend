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

module.exports = { listar, obter, criar, atualizar, remover };
