const { randomUUID } = require('crypto');

const BASE_URL = 'https://api.mercadopago.com';

async function mpRequest(accessToken, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(method === 'POST' ? { 'X-Idempotency-Key': randomUUID() } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const err = new Error((data && (data.message || data.error)) || `Erro Mercado Pago (${res.status})`);
    err.status = 502;
    err.mpStatus = res.status;
    err.mpResponse = data;
    throw err;
  }

  return data;
}

function obterUsuario(accessToken) {
  return mpRequest(accessToken, '/users/me');
}

async function listarDevices(accessToken) {
  const data = await mpRequest(accessToken, '/point/integration-api/devices');
  return (data && data.devices) || [];
}

// NOTE: confirmar a unidade de "amount" (centavos vs. valor decimal) e os nomes exatos dos
// campos aceitos pela Point Integration API na documentação atual do Mercado Pago antes de
// usar em produção — a API de dispositivos Point é sujeita a mudanças.
function criarPaymentIntent(accessToken, deviceId, { amount, externalReference, description, notificationUrl }) {
  return mpRequest(accessToken, `/point/integration-api/devices/${deviceId}/payment-intents`, {
    method: 'POST',
    body: {
      amount,
      additional_info: {
        external_reference: externalReference,
        print_on_terminal: true,
      },
      ...(description ? { description } : {}),
      ...(notificationUrl ? { notification_url: notificationUrl } : {}),
    },
  });
}

function obterPaymentIntent(accessToken, deviceId, paymentIntentId) {
  return mpRequest(accessToken, `/point/integration-api/devices/${deviceId}/payment-intents/${paymentIntentId}`);
}

function cancelarPaymentIntent(accessToken, deviceId, paymentIntentId) {
  return mpRequest(accessToken, `/point/integration-api/devices/${deviceId}/payment-intents/${paymentIntentId}`, {
    method: 'DELETE',
  });
}

module.exports = {
  obterUsuario,
  listarDevices,
  criarPaymentIntent,
  obterPaymentIntent,
  cancelarPaymentIntent,
};
