const service = require('./mercadopago.service');

async function configurarToken(req, res, next) {
  try {
    const { accessToken } = req.body;
    const resultado = await service.configurarToken(req.params.id, accessToken);
    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function listarDevices(req, res, next) {
  try {
    const devices = await service.listarDevicesDoCaixa(req.params.id);
    res.json(devices);
  } catch (err) {
    next(err);
  }
}

async function associarDevice(req, res, next) {
  try {
    const { deviceId } = req.body;
    const caixa = await service.associarDevice(req.params.id, deviceId);
    res.json(caixa);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const caixa = await service.removerConfiguracao(req.params.id);
    res.json(caixa);
  } catch (err) {
    next(err);
  }
}

// Sempre responde 200 para o Mercado Pago não ficar reenviando a notificação em loop;
// qualquer erro de processamento fica só no log do servidor.
async function webhook(req, res) {
  try {
    const caixaId = req.query.caixaId;
    if (caixaId) {
      await service.processarWebhook(caixaId, req.body);
    }
  } catch (err) {
    console.error('Erro ao processar webhook Mercado Pago:', err);
  }
  res.status(200).send('OK');
}

module.exports = { configurarToken, listarDevices, associarDevice, remover, webhook };
