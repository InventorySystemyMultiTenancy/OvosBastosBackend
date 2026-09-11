const prisma = require('../../config/db');
const crypto = require('../../utils/crypto');
const mpClient = require('./mercadopago.client');

const STATUS_MP_ATIVOS = ['PENDENTE', 'EM_PROCESSO'];

function erro(status, message) {
  return Object.assign(new Error(message), { status });
}

// Toda comparação de valor usa centavos inteiros (Math.round evita drift de float) — dois
// pagamentos de maquininha "batendo certinho" com o total da venda depende disso.
function centavos(valor) {
  return Math.round(Number(valor || 0) * 100);
}

function formatBRL(valor) {
  return `R$ ${Number(valor || 0).toFixed(2).replace('.', ',')}`;
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

// Monta o estado completo de cobranças de uma venda — usado como resposta única pelos 3
// endpoints HTTP (enviar/cancelar/consultar), pra frontend tratar os três com o mesmo handler.
async function montarResumo(vendaId) {
  const venda = await prisma.venda.findUnique({
    where: { id: Number(vendaId) },
    select: { total: true, valorDinheiro: true, pagamentosPointMP: { orderBy: { createdAt: 'asc' } } },
  });
  if (!venda) throw erro(404, 'Venda não encontrada');

  const pagamentos = venda.pagamentosPointMP;
  const valorPagoMaquininhaCentavos = pagamentos
    .filter((p) => p.status === 'APROVADO')
    .reduce((soma, p) => soma + centavos(p.valor), 0);
  const restanteCentavos = Math.max(
    centavos(venda.total) - centavos(venda.valorDinheiro) - valorPagoMaquininhaCentavos,
    0
  );
  const cobrancaAtiva = pagamentos.find((p) => STATUS_MP_ATIVOS.includes(p.status)) || null;

  return {
    pagamentos,
    resumo: {
      total: Number(venda.total),
      valorDinheiro: Number(venda.valorDinheiro || 0),
      valorPagoMaquininha: valorPagoMaquininhaCentavos / 100,
      valorRestante: restanteCentavos / 100,
      completo: restanteCentavos <= 0,
      cobrancaAtiva,
    },
  };
}

// Recalcula se a soma do que já foi aprovado na maquininha (+ dinheiro já recebido) cobre o
// total da venda e, se sim, confirma — chamada tanto ao aprovar uma cobrança quanto ao
// reconsultar o status (self-heal pra vendas reabertas que já estavam quitadas).
async function verificarQuitacaoEConfirmar(vendaId) {
  const venda = await prisma.venda.findUnique({
    where: { id: Number(vendaId) },
    select: { status: true, total: true, valorDinheiro: true, pagamentosPointMP: { select: { status: true, valor: true } } },
  });
  if (!venda || venda.status !== 'ORCAMENTO') return;

  const pagoMaquininhaCentavos = venda.pagamentosPointMP
    .filter((p) => p.status === 'APROVADO')
    .reduce((soma, p) => soma + centavos(p.valor), 0);
  const restanteCentavos = centavos(venda.total) - centavos(venda.valorDinheiro) - pagoMaquininhaCentavos;

  if (restanteCentavos <= 0) {
    const { confirmarVenda } = require('../vendas/vendas.service');
    await confirmarVenda(vendaId, { formaPagamento: 'CARTAO' }).catch((err) => {
      console.error(`Falha ao confirmar venda ${vendaId} após quitação via Mercado Pago:`, err.message);
    });
  }
}

async function enviarCobranca(vendaId, valorInformado) {
  const id = Number(vendaId);
  const venda = await prisma.venda.findUnique({ where: { id }, include: { caixa: true } });
  if (!venda) throw erro(404, 'Venda não encontrada');
  if (venda.status !== 'ORCAMENTO') throw erro(400, 'Somente orçamentos podem ser enviados para a maquininha');
  if (!venda.caixa) throw erro(400, 'Venda sem caixa definido');

  const { accessToken, deviceId } = credenciaisAtivas(venda.caixa);

  // Uma cobrança de cada vez por venda — é isso que garante "enviar X, esperar pagar, só
  // depois enviar Y" no pagamento dividido entre débito e crédito.
  const ativaDestaVenda = await prisma.pagamentoPointMP.findFirst({
    where: { vendaId: id, status: { in: STATUS_MP_ATIVOS } },
    orderBy: { createdAt: 'desc' },
  });
  if (ativaDestaVenda) {
    const statusReal = await statusResincronizado(ativaDestaVenda, accessToken);
    if (STATUS_MP_ATIVOS.includes(statusReal)) {
      throw erro(409, 'Já existe uma cobrança em aberto para esta venda nesta maquininha');
    }
  }

  // A maquininha só aceita uma cobrança ativa por vez (erro 2205 da API do Mercado Pago).
  // Se outra venda deixou uma cobrança pendente no mesmo device, avisa antes de tentar criar.
  const outraPendenteNoDevice = await prisma.pagamentoPointMP.findFirst({
    where: { deviceId, status: { in: STATUS_MP_ATIVOS }, vendaId: { not: id } },
  });
  if (outraPendenteNoDevice) {
    const statusReal = await statusResincronizado(outraPendenteNoDevice, accessToken);
    if (STATUS_MP_ATIVOS.includes(statusReal)) {
      throw erro(
        409,
        `Esta maquininha já tem uma cobrança em aberto (venda #${outraPendenteNoDevice.vendaId}). Cancele ou finalize antes de enviar outra.`
      );
    }
  }

  const { resumo } = await montarResumo(id);
  const restanteCentavos = centavos(resumo.valorRestante);
  if (restanteCentavos <= 0) {
    throw erro(400, 'Esta venda já está totalmente coberta — não é preciso enviar outra cobrança');
  }

  // Pagamento dividido: por padrão manda o que falta inteiro (comportamento de sempre), mas o
  // operador pode informar um valor parcial — ex: metade no débito, o resto depois no crédito.
  const valorCentavos =
    valorInformado !== undefined && valorInformado !== null && valorInformado !== ''
      ? centavos(valorInformado)
      : restanteCentavos;

  if (valorCentavos <= 0) {
    throw erro(400, 'O valor da cobrança deve ser maior que zero');
  }
  if (valorCentavos > restanteCentavos + 1) {
    throw erro(
      400,
      `Valor informado (${formatBRL(valorCentavos / 100)}) excede o saldo restante da venda (${formatBRL(restanteCentavos / 100)})`
    );
  }

  const valorCobranca = valorCentavos / 100;

  const order = await mpClient.criarOrder(accessToken, {
    terminalId: deviceId,
    amount: valorCobranca.toFixed(2),
    externalReference: `venda-${id}`,
    description: `Venda #${id}`,
  });

  await prisma.pagamentoPointMP.create({
    data: {
      vendaId: id,
      caixaId: venda.caixaId,
      deviceId,
      paymentIntentId: order.id,
      status: 'PENDENTE',
      valor: valorCobranca,
      detalhes: order,
    },
  });

  return montarResumo(id);
}

async function cancelarCobranca(vendaId) {
  const id = Number(vendaId);
  const pagamento = await prisma.pagamentoPointMP.findFirst({
    where: { vendaId: id, status: { in: STATUS_MP_ATIVOS } },
    orderBy: { createdAt: 'desc' },
    include: { caixa: true },
  });
  if (!pagamento) throw erro(404, 'Nenhuma cobrança em aberto para esta venda');

  const { accessToken } = credenciaisAtivas(pagamento.caixa);
  try {
    await mpClient.cancelarOrder(accessToken, pagamento.paymentIntentId, { atTerminal: pagamento.status === 'EM_PROCESSO' });
  } catch (err) {
    if (err.mpStatus !== 404) throw err;
  }

  await prisma.pagamentoPointMP.update({ where: { id: pagamento.id }, data: { status: 'CANCELADO' } });
  return montarResumo(id);
}

async function listarStatusPagamentos(vendaId) {
  const id = Number(vendaId);
  const venda = await prisma.venda.findUnique({ where: { id }, include: { caixa: true, pagamentosPointMP: true } });
  if (!venda) throw erro(404, 'Venda não encontrada');

  const ativo = venda.pagamentosPointMP.find((p) => STATUS_MP_ATIVOS.includes(p.status));
  if (ativo) {
    const { accessToken } = credenciaisAtivas(venda.caixa);
    const order = await mpClient.obterOrder(accessToken, ativo.paymentIntentId).catch(() => null);
    if (order) await aplicarStatusIntent(ativo, order);
  }

  await verificarQuitacaoEConfirmar(id);
  return montarResumo(id);
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
  // Tipo real do meio de pagamento (credit_card/debit_card/...) só vem preenchido depois que
  // o pagamento é processado — alimenta o fechamento do dia (dashboard). Nunca sobrescreve um
  // valor já detectado com null (uma reconsulta antes do terminal processar não deve apagar).
  const tipoDetectado = order?.transactions?.payments?.[0]?.payment_method?.type;

  const atualizado = await prisma.pagamentoPointMP.update({
    where: { id: pagamento.id },
    data: {
      status: novoStatus,
      detalhes: order,
      ...(tipoDetectado ? { tipoPagamentoDetectado: tipoDetectado } : {}),
    },
  });

  if (novoStatus === 'APROVADO' && pagamento.status !== 'APROVADO') {
    await verificarQuitacaoEConfirmar(pagamento.vendaId);
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
  listarStatusPagamentos,
  processarWebhook,
};
