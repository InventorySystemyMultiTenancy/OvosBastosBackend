const service = require('./analiseReposicao.service');

async function obter(req, res, next) {
  try {
    res.json(await service.obterAnaliseAtual());
  } catch (err) {
    next(err);
  }
}

module.exports = { obter };
