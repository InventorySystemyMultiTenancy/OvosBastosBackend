const prisma = require('../../config/db');

// Nunca inclui mpAccessTokenEnc: é o access token criptografado da conta Mercado Pago
// daquele caixa e não deve sair do backend.
const SELECT_SEGURO = {
  id: true,
  nome: true,
  unidade: true,
  ativo: true,
  createdAt: true,
  mpUserId: true,
  mpNicknameConta: true,
  mpDeviceId: true,
};

function comMpConfigurado(caixa) {
  return { ...caixa, mpConfigurado: Boolean(caixa.mpDeviceId) };
}

async function listar(req, res, next) {
  try {
    const where = req.query.ativo !== undefined ? { ativo: req.query.ativo === 'true' } : {};
    const caixas = await prisma.caixa.findMany({ where, orderBy: { id: 'asc' }, select: SELECT_SEGURO });
    res.json(caixas.map(comMpConfigurado));
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
    const caixa = await prisma.caixa.create({
      data: { nome: nome.trim(), unidade: unidade.trim() },
      select: SELECT_SEGURO,
    });
    res.status(201).json(comMpConfigurado(caixa));
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

    const caixa = await prisma.caixa.update({ where: { id: Number(req.params.id) }, data, select: SELECT_SEGURO });
    res.json(comMpConfigurado(caixa));
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar };
