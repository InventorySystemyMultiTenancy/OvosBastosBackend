const prisma = require('../../config/db');

async function listar(req, res, next) {
  try {
    const where = req.query.ativo !== undefined ? { ativo: req.query.ativo === 'true' } : {};
    const caixas = await prisma.caixa.findMany({ where, orderBy: { id: 'asc' } });
    res.json(caixas);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, unidade } = req.body;
    if (!nome || !nome.trim() || !unidade || !unidade.trim()) {
      return res.status(400).json({ error: 'nome e unidade são obrigatórios' });
    }
    const caixa = await prisma.caixa.create({ data: { nome: nome.trim(), unidade: unidade.trim() } });
    res.status(201).json(caixa);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { nome, unidade, ativo } = req.body;
    const data = {};
    if (nome !== undefined) data.nome = nome.trim();
    if (unidade !== undefined) data.unidade = unidade.trim();
    if (ativo !== undefined) data.ativo = Boolean(ativo);

    const caixa = await prisma.caixa.update({ where: { id: Number(req.params.id) }, data });
    res.json(caixa);
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar };
