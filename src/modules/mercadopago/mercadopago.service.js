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

  const devices = await mpClient.listarTerminais(tokenLimpo).catch(() => []);

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
  return mpClient.listarTerminais(accessToken);
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
  const devices = await mpClient.listarTerminais(accessToken);
  const device = devices.find((d) => d.id === deviceId);
  if (!device) throw erro(400, 'Maquininha não encontrada nesta conta Mercado Pago');

  await mpClient.definirModoPdv(accessToken, deviceId).catch((err) => {
    console.error(`Falha ao definir modo PDV na maquininha ${deviceId}:`, err.message);
  });

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

// Um pagamento marcado PENDENTE/EM_PROCESSO no nosso banco pode estar desatualizado — por
// exemplo, se a order foi cancelada direto na maquininha (at_terminal só cancela no aparelho,
// nunca pela API) e ainda não chegou webhook. Reconsulta a API antes de confiar no status local.
async function statusResincronizado(pagamento, accessToken) {
  const order = await mpClient.obterOrder(accessToken, pagamento.paymentIntentId).catch(() => null);
  if (!order) return pagamento.status;
  const atualizado = await aplicarStatusIntent(pagamento, order);
  return atualizado.status;
}

async function enviarCobranca(vendaId) {
  const venda = await prisma.venda.findUnique({ where: { id: Number(vendaId) }, include: { caixa: true } });
  if (!venda) throw erro(404, 'Venda não encontrada');
  if (venda.status !== 'ORCAMENTO') throw erro(400, 'Somente orçamentos podem ser enviados para a maquininha');
  if (!venda.caixa) throw erro(400, 'Venda sem caixa definido');

  const { accessToken, deviceId } = credenciaisAtivas(venda.caixa);

  const existente = await prisma.pagamentoPointMP.findUnique({ where: { vendaId: venda.id } });
  if (existente && ['PENDENTE', 'EM_PROCESSO'].includes(existente.status)) {
    const statusReal = await statusResincronizado(existente, accessToken);
    if (['PENDENTE', 'EM_PROCESSO'].includes(statusReal)) {
      throw erro(409, 'Já existe uma cobrança em aberto para esta venda nesta maquininha');
    }
  }

  // A maquininha só aceita uma cobrança ativa por vez (erro 2205 da API do Mercado Pago).
  // Se outra venda deixou uma cobrança pendente no mesmo device, avisa antes de tentar criar.
  const outraPendenteNoDevice = await prisma.pagamentoPointMP.findFirst({
    where: { deviceId, status: { in: ['PENDENTE', 'EM_PROCESSO'] }, vendaId: { not: venda.id } },
  });
  if (outraPendenteNoDevice) {
    const statusReal = await statusResincronizado(outraPendenteNoDevice, accessToken);
    if (['PENDENTE', 'EM_PROCESSO'].includes(statusReal)) {
      throw erro(
        409,
        `Esta maquininha já tem uma cobrança em aberto (venda #${outraPendenteNoDevice.vendaId}). Cancele ou finalize antes de enviar outra.`
      );
    }
  }

  // Pagamento dividido: só o que sobra depois do dinheiro já recebido vai pra maquininha.
  const valorCobranca = Number(venda.total) - Number(venda.valorDinheiro || 0);

  const order = await mpClient.criarOrder(accessToken, {
    terminalId: deviceId,
    amount: valorCobranca.toFixed(2),
    externalReference: `venda-${venda.id}`,
    description: `Venda #${venda.id}`,
  });

  return prisma.pagamentoPointMP.upsert({
    where: { vendaId: venda.id },
    create: {
      vendaId: venda.id,
      caixaId: venda.caixaId,
      deviceId,
      paymentIntentId: order.id,
      status: 'PENDENTE',
      valor: valorCobranca,
      detalhes: order,
    },
    update: {
      deviceId,
      paymentIntentId: order.id,
      status: 'PENDENTE',
      valor: valorCobranca,
      detalhes: order,
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
    await mpClient.cancelarOrder(accessToken, pagamento.paymentIntentId, { atTerminal: pagamento.status === 'EM_PROCESSO' });
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
  const order = await mpClient.obterOrder(accessToken, pagamento.paymentIntentId);

  return aplicarStatusIntent(pagamento, order);
}

// Mapeamento conforme a doc oficial da API de Orders (developers.mercadopago.com/pt/docs/
// mp-point/migrate-payment-intent-to-orders): created = criada, ainda não enviada ao
// terminal; at_terminal = ativa no aparelho (só cancela no próprio terminal);
// action_required = precisa de alguma ação extra (ex: confirmação manual); processed/failed
// já vêm "fechados" (sucesso/recusa definitivos, sem precisar consultar mais nada);
// expired/canceled cobrem os fins por tempo esgotado ou cancelamento. "refunded" (estorno)
// não tem fluxo próprio aqui ainda — mantém como aprovado, já que a venda já foi confirmada.
function mapearStatus(orderStatus) {
  const mapa = {
    created: 'PENDENTE',
    at_terminal: 'EM_PROCESSO',
    action_required: 'EM_PROCESSO',
    processed: 'APROVADO',
    refunded: 'APROVADO',
    failed: 'REJEITADO',
    expired: 'CANCELADO',
    canceled: 'CANCELADO',
  };
  return mapa[orderStatus] || 'EM_PROCESSO';
}

async function aplicarStatusIntent(pagamento, order) {
  const novoStatus = mapearStatus(order.status);

  const atualizado = await prisma.pagamentoPointMP.update({
    where: { id: pagamento.id },
    data: { status: novoStatus, detalhes: order },
  });

  if (novoStatus === 'APROVADO' && pagamento.status !== 'APROVADO') {
    const { confirmarVenda } = require('../vendas/vendas.service');
    await confirmarVenda(pagamento.vendaId, { formaPagamento: 'CARTAO' }).catch((err) => {
      console.error(`Falha ao confirmar venda ${pagamento.vendaId} após aprovação Mercado Pago:`, err.message);
    });
  }

  return atualizado;
}

// A API de Orders não aceita mais notification_url por requisição (só assinatura de webhook
// por aplicação, tópico "orders", configurada uma vez no painel do Mercado Pago) — então a
// notificação não carrega mais o caixaId na URL. Em vez disso, acha o pagamento pelo id da
// order (que já é único e foi salvo na criação) e usa o caixaId que já estava gravado nele
// pra saber com qual token da conta consultar de volta — nunca confiamos no corpo da
// notificação pra decidir se um pagamento foi aprovado, só como gatilho pra reconsultar.
async function processarWebhook(payload) {
  const orderId = (payload && (payload.id || (payload.data && payload.data.id))) || undefined;
  if (!orderId) return;

  const pagamento = await prisma.pagamentoPointMP.findUnique({ where: { paymentIntentId: orderId }, include: { caixa: true } });
  if (!pagamento || !pagamento.caixa?.mpAccessTokenEnc) return;

  const accessToken = crypto.decrypt(pagamento.caixa.mpAccessTokenEnc);
  const order = await mpClient.obterOrder(accessToken, pagamento.paymentIntentId);
  await aplicarStatusIntent(pagamento, order);
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
