const service = require('./recebimentos.service');

async function listar(req, res, next) {
  try {
    res.json(await service.listar());
  } catch (err) {
    next(err);
  }
}

async function obter(req, res, next) {
  try {
    res.json(await service.obter(req.params.id));
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { itens, observacao } = req.body;
    const recebimento = await service.criar({ itens, observacao, criadoPorId: req.usuario?.id });
    res.status(201).json(recebimento);
  } catch (err) {
    next(err);
  }
}

async function definirFornecedor(req, res, next) {
  try {
    res.json(await service.definirFornecedor(req.params.id, req.body.fornecedorId));
  } catch (err) {
    next(err);
  }
}

async function distribuir(req, res, next) {
  try {
    res.json(await service.distribuir(req.params.id, req.body.distribuicoes));
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, definirFornecedor, distribuir };
