const { randomUUID } = require('crypto');

const BASE_URL = 'https://api.mercadopago.com';

async function mpRequest(accessToken, path, { method = 'GET', body, headers } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      // Exigido pela API de Orders em POST/PATCH (create, cancel, refund, setup de terminal) —
      // evita duplicar a ação se a requisição for reenviada.
      ...(['POST', 'PATCH'].includes(method) ? { 'X-Idempotency-Key': randomUUID() } : {}),
      ...headers,
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

// API de Orders (substitui a Point Integration API legada, que só aceitava cartão/aproximação —
// ver migração em developers.mercadopago.com/pt/docs/mp-point/migrate-payment-intent-to-orders).
async function listarTerminais(accessToken) {
  const data = await mpRequest(accessToken, '/terminals/v1/list');
  return (data && data.data && data.data.terminals) || [];
}

// A maquininha só recebe orders criados pela API se estiver no modo "PDV"; no modo
// "STANDALONE" (padrão de fábrica / venda avulsa) ela nunca exibe o pedido. Requer reiniciar
// o aparelho pra pegar a mudança.
function definirModoPdv(accessToken, terminalId) {
  return mpRequest(accessToken, '/terminals/v1/setup', {
    method: 'PATCH',
    body: { terminals: [{ id: terminalId, operating_mode: 'PDV' }] },
  });
}

// amount é string decimal (ex: "24.00"), não mais centavos inteiros — mudança da API de
// Orders. Sem config.payment_method: deixa o terminal oferecer todas as formas habilitadas
// na conta (inclusive Pix) em vez de travar em cartão de crédito.
function criarOrder(accessToken, { terminalId, amount, externalReference, description }) {
  return mpRequest(accessToken, '/v1/orders', {
    method: 'POST',
    body: {
      type: 'point',
      external_reference: externalReference,
      transactions: { payments: [{ amount }] },
      config: {
        point: { terminal_id: terminalId, print_on_terminal: 'seller_ticket' },
      },
      ...(description ? { description } : {}),
    },
  });
}

function obterOrder(accessToken, orderId) {
  return mpRequest(accessToken, `/v1/orders/${orderId}`);
}

function cancelarOrder(accessToken, orderId, { atTerminal = false } = {}) {
  return mpRequest(accessToken, `/v1/orders/${orderId}/cancel`, {
    method: 'POST',
    // Só uma order em "at_terminal" (enviada pro aparelho) exige esse header extra pra
    // permitir cancelamento — nos outros status o cancelamento simples já basta.
    headers: atTerminal ? { 'x-allow-cancelable-status': 'at_terminal' } : {},
  });
}

module.exports = {
  obterUsuario,
  listarTerminais,
  definirModoPdv,
  criarOrder,
  obterOrder,
  cancelarOrder,
};
