const service = require('./analiseReposicao.service');

async function obter(req, res, next) {
  try {
    res.json(await service.obterAnaliseAtual());
  } catch (err) {
    next(err);
  }
}

async function gerar(req, res, next) {
  try {
    const analise = await service.gerarAnaliseDoDia({ forcar: true });
    res.json({ ...analise, stale: false, modoFallback: false });
  } catch (err) {
    next(err);
  }
}

module.exports = { obter, gerar };
