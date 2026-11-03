const prisma = require('../config/db');

// Valor extra por item (nível de venda) que cada caixa cobra em cima do preço normal — ver
// AcrescimoCaixaNivel no schema. Compartilhado entre o catálogo do caixa
// (caixas.controller.estoquePorCaixa) e o checkout (vendas.service.processarCheckout), pra
// que o preço mostrado no PDV seja exatamente o preço cobrado.

async function mapaAcrescimos(caixaId, nivelIds) {
  if (!caixaId) return new Map();
  const where = { caixaId: Number(caixaId) };
  if (nivelIds) where.nivelVendaId = { in: nivelIds };
  const acrescimos = await prisma.acrescimoCaixaNivel.findMany({ where });
  return new Map(acrescimos.map((a) => [a.nivelVendaId, Number(a.valor)]));
}

function precoComAcrescimo(precoNivel, acrescimo) {
  return Math.round((Number(precoNivel) + (acrescimo || 0)) * 100) / 100;
}

module.exports = { mapaAcrescimos, precoComAcrescimo };
