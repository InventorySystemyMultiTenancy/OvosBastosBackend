const prisma = require('../../config/db');
const crypto = require('../../utils/crypto');
const mpClient = require('./mercadopago.client');

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

async function buscarCaixaOuFalhar(caixaId) {
  const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) } });
  if (!caixa) throw erro(404, 'Caixa não encontrado');
  return caixa;
}

async function configurarToken(caixaId, accessToken) {
  if (!accessToken || !accessToken.trim()) {
    throw erro(400, 'accessToken é obrigatório');
  }
  await buscarCaixaOuFalhar(caixaId);

  const tokenLimpo = accessToken.trim();
  let usuario;
  try {
    usuario = await mpClient.obterUsuario(tokenLimpo);
  } catch (err) {
    throw erro(400, 'Access Token inválido: não foi possível autenticar na conta Mercado Pago');
  }

  const contaJaUsada = await prisma.caixa.findFirst({
    where: { mpUserId: String(usuario.id), id: { not: Number(caixaId) } },
  });
  if (contaJaUsada) {
    throw erro(409, `Esta conta Mercado Pago já está associada ao caixa "${contaJaUsada.nome}"`);
  }

  const devices = await mpClient.listarDevices(tokenLimpo).catch(() => []);

  await prisma.caixa.update({
    where: { id: Number(caixaId) },
    data: {
      mpAccessTokenEnc: crypto.encrypt(tokenLimpo),
      mpUserId: String(usuario.id),
      mpNicknameConta: usuario.nickname || usuario.email || null,
      mpDeviceId: null,
    },
  });

  return { usuario: { id: usuario.id, nickname: usuario.nickname || usuario.email }, devices };
}

async function listarDevicesDoCaixa(caixaId) {
  const caixa = await buscarCaixaOuFalhar(caixaId);
  if (!caixa.mpAccessTokenEnc) throw erro(400, 'Caixa sem Access Token do Mercado Pago configurado');
  const accessToken = crypto.decrypt(caixa.mpAccessTokenEnc);
  return mpClient.listarDevices(accessToken);
}

async function associarDevice(caixaId, deviceId) {
  const caixa = await buscarCaixaOuFalhar(caixaId);
  if (!caixa.mpAccessTokenEnc) throw erro(400, 'Configure o Access Token antes de associar a maquininha');
  if (!deviceId) throw erro(400, 'deviceId é obrigatório');

  const outroCaixaComDevice = await prisma.caixa.findFirst({
    where: { mpDeviceId: deviceId, id: { not: Number(caixaId) } },
  });
  if (outroCaixaComDevice) {
    throw erro(409, `Esta maquininha já está associada ao caixa "${outroCaixaComDevice.nome}"`);
  }

  const accessToken = crypto.decrypt(caixa.mpAccessTokenEnc);
  const devices = await mpClient.listarDevices(accessToken);
  const device = devices.find((d) => d.id === deviceId);
  if (!device) throw erro(400, 'Maquininha não encontrada nesta conta Mercado Pago');

  return prisma.caixa.update({
    where: { id: Number(caixaId) },
    data: { mpDeviceId: deviceId },
    select: { id: true, nome: true, mpDeviceId: true, mpUserId: true, mpNicknameConta: true },
  });
}

async function removerConfiguracao(caixaId) {
  await buscarCaixaOuFalhar(caixaId);
  return prisma.caixa.update({
    where: { id: Number(caixaId) },
    data: { mpAccessTokenEnc: null, mpUserId: null, mpNicknameConta: null, mpDeviceId: null },
    select: { id: true, nome: true },
  });
}

function credenciaisAtivas(caixa) {
  if (!caixa.mpAccessTokenEnc || !caixa.mpDeviceId) {
    throw erro(400, 'Este caixa não tem uma maquininha Mercado Pago configurada');
  }
  return { accessToken: crypto.decrypt(caixa.mpAccessTokenEnc), deviceId: caixa.mpDeviceId };
}

function urlWebhook(caixaId) {
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/api/mercadopago/webhook?caixaId=${caixaId}` : undefined;
}

async function enviarCobranca(vendaId) {
  const venda = await prisma.venda.findUnique({ where: { id: Number(vendaId) }, include: { caixa: true } });
  if (!venda) throw erro(404, 'Venda não encontrada');
  if (venda.status !== 'ORCAMENTO') throw erro(400, 'Somente orçamentos podem ser enviados para a maquininha');
  if (!venda.caixa) throw erro(400, 'Venda sem caixa definido');

  const existente = await prisma.pagamentoPointMP.findUnique({ where: { vendaId: venda.id } });
  if (existente && ['PENDENTE', 'EM_PROCESSO'].includes(existente.status)) {
    throw erro(409, 'Já existe uma cobrança em aberto para esta venda nesta maquininha');
  }

  const { accessToken, deviceId } = credenciaisAtivas(venda.caixa);

  const intent = await mpClient.criarPaymentIntent(accessToken, deviceId, {
    amount: Math.round(Number(venda.total) * 100),
    externalReference: `venda-${venda.id}`,
    description: `Venda #${venda.id}`,
    notificationUrl: urlWebhook(venda.caixaId),
  });

  return prisma.pagamentoPointMP.upsert({
    where: { vendaId: venda.id },
    create: {
      vendaId: venda.id,
      caixaId: venda.caixaId,
      deviceId,
      paymentIntentId: intent.id,
      status: 'PENDENTE',
      valor: venda.total,
      detalhes: intent,
    },
    update: {
      deviceId,
      paymentIntentId: intent.id,
      status: 'PENDENTE',
      valor: venda.total,
      detalhes: intent,
    },
  });
}

async function cancelarCobranca(vendaId) {
  const pagamento = await prisma.pagamentoPointMP.findUnique({
    where: { vendaId: Number(vendaId) },
    include: { caixa: true },
  });
  if (!pagamento) throw erro(404, 'Nenhuma cobrança encontrada para esta venda');

  const { accessToken } = credenciaisAtivas(pagamento.caixa);
  try {
    await mpClient.cancelarPaymentIntent(accessToken, pagamento.deviceId, pagamento.paymentIntentId);
  } catch (err) {
    if (err.mpStatus !== 404) throw err;
  }

  return prisma.pagamentoPointMP.update({ where: { id: pagamento.id }, data: { status: 'CANCELADO' } });
}

async function sincronizarStatus(vendaId) {
  const pagamento = await prisma.pagamentoPointMP.findUnique({
    where: { vendaId: Number(vendaId) },
    include: { caixa: true },
  });
  if (!pagamento) throw erro(404, 'Nenhuma cobrança encontrada para esta venda');

  const { accessToken } = credenciaisAtivas(pagamento.caixa);
  const intent = await mpClient.obterPaymentIntent(accessToken, pagamento.deviceId, pagamento.paymentIntentId);

  return aplicarStatusIntent(pagamento, intent);
}

// NOTE: confirmar os valores exatos do campo "state" retornado pela Point Integration API
// na documentação atual do Mercado Pago — mapeamento feito com base no comportamento
// conhecido (OPEN/ON_TERMINAL/PROCESSING/FINISHED/ERROR/CANCELED) e pode mudar.
function mapearStatus(intentState) {
  const mapa = {
    OPEN: 'PENDENTE',
    ON_TERMINAL: 'EM_PROCESSO',
    PROCESSING: 'EM_PROCESSO',
    FINISHED: 'APROVADO',
    ERROR: 'REJEITADO',
    CANCELED: 'CANCELADO',
  };
  return mapa[intentState] || 'EM_PROCESSO';
}

async function aplicarStatusIntent(pagamento, intent) {
  const novoStatus = mapearStatus(intent.state);

  const atualizado = await prisma.pagamentoPointMP.update({
    where: { id: pagamento.id },
    data: { status: novoStatus, detalhes: intent },
  });

  if (novoStatus === 'APROVADO' && pagamento.status !== 'APROVADO') {
    const { confirmarVenda } = require('../vendas/vendas.service');
    await confirmarVenda(pagamento.vendaId, { formaPagamento: 'CARTAO' }).catch((err) => {
      console.error(`Falha ao confirmar venda ${pagamento.vendaId} após aprovação Mercado Pago:`, err.message);
    });
  }

  return atualizado;
}

// O caixaId vem da query string que nós mesmos definimos em notification_url ao criar o
// payment intent — por isso a notificação só serve de gatilho: o status real é sempre
// buscado de volta na API do Mercado Pago com o token daquele caixa (nunca confiamos no
// corpo da notificação para decidir se um pagamento foi aprovado).
async function processarWebhook(caixaId, payload) {
  const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) } });
  if (!caixa || !caixa.mpAccessTokenEnc) return;

  const paymentIntentId = (payload && (payload.id || (payload.data && payload.data.id))) || undefined;
  if (!paymentIntentId) return;

  const pagamento = await prisma.pagamentoPointMP.findUnique({ where: { paymentIntentId } });
  if (!pagamento || pagamento.caixaId !== caixa.id) return;

  const accessToken = crypto.decrypt(caixa.mpAccessTokenEnc);
  const intent = await mpClient.obterPaymentIntent(accessToken, pagamento.deviceId, pagamento.paymentIntentId);
  await aplicarStatusIntent(pagamento, intent);
}

module.exports = {
  configurarToken,
  listarDevicesDoCaixa,
  associarDevice,
  removerConfiguracao,
  enviarCobranca,
  cancelarCobranca,
  sincronizarStatus,
  processarWebhook,
};
