const prisma = require('../../config/db');

function sessaoAbertaDoCaixa(caixaId) {
  return prisma.sessaoCaixa.findFirst({ where: { caixaId: Number(caixaId), status: 'ABERTA' } });
}

// Usada pelo checkout (venda com caixa associada) — sem sessão aberta, não tem contagem de
// dinheiro em andamento pra aquela unidade, então nenhuma venda em dinheiro pode ser
// registrada nela.
async function exigirCaixaAberto(caixaId) {
  const sessao = await sessaoAbertaDoCaixa(caixaId);
  if (!sessao) {
    throw Object.assign(
      new Error('O caixa desta unidade ainda não foi aberto — conte o dinheiro físico e abra o caixa antes de vender.'),
      { status: 400 }
    );
  }
  return sessao;
}

module.exports = { sessaoAbertaDoCaixa, exigirCaixaAberto };
