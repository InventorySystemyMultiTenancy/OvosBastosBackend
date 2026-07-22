const prisma = require('../../config/db');

async function listar(req, res, next) {
  try {
    const clientes = await prisma.cliente.findMany({
      where: { ativo: true },
      include: { bandeja: true },
      orderBy: { nome: 'asc' },
    });
    res.json(clientes);
  } catch (err) {
    next(err);
  }
}

async function obter(req, res, next) {
  try {
    const cliente = await prisma.cliente.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        bandeja: true,
        vendas: { orderBy: { createdAt: 'desc' }, take: 20, include: { itens: { include: { produto: true } } } },
        contasReceber: { orderBy: { vencimento: 'asc' } },
      },
    });
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado' });
    res.json(cliente);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, documento, telefone, email, endereco, cidade, limiteCredito } = req.body;
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });

    const cliente = await prisma.cliente.create({
      data: {
        nome,
        documento,
        telefone,
        email,
        endereco,
        cidade,
        limiteCredito: limiteCredito || 0,
        bandeja: { create: {} },
      },
      include: { bandeja: true },
    });
    res.status(201).json(cliente);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { nome, documento, telefone, email, endereco, cidade, limiteCredito } = req.body;
    const cliente = await prisma.cliente.update({
      where: { id: Number(req.params.id) },
      data: { nome, documento, telefone, email, endereco, cidade, limiteCredito },
    });
    res.json(cliente);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    await prisma.cliente.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, atualizar, remover };
