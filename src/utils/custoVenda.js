// Compartilhado entre dashboard.controller.js e financeiro.controller.js — os dois precisam
// do mesmo cálculo de "quanto isso vendeu de verdade" e "quanto isso custou" pra que o Lucro
// Líquido bata igual em qualquer tela que o mostre.

// Item vendido como embalagem/"caixa" tem quantidade em número de embalagens, não no
// grão-base do estoque; item normal de um produto fracionável (Produto.unidadesPorPacote > 1)
// tem quantidade em "unidade" (dúzia/bandeja), não no grão-base. Item vendidoPorUnidade já
// vem no grão-base.
function unidadesVendidas(item) {
  if (item.embalagemId) return item.quantidade * item.bandejasPorEmbalagem;
  if (item.vendidoPorUnidade) return item.quantidade;
  return item.quantidade * (item.produto?.unidadesPorPacote || 1);
}

// Soma o custo (Produto.precoCusto, convertido pro mesmo grão-base de unidadesVendidas) de
// uma lista de itens de venda. Item sem precoCusto cadastrado não entra na soma (custo
// desconhecido != zero) — é assim que o Lucro Líquido desconta custo de produto, não só
// despesas operacionais.
function custoTotalDosItens(itens) {
  return itens.reduce((soma, i) => {
    if (i.produto.precoCusto === null) return soma;
    const precoCustoBase = Number(i.produto.precoCusto) / (i.produto.unidadesPorPacote || 1);
    return soma + precoCustoBase * unidadesVendidas(i);
  }, 0);
}

module.exports = { unidadesVendidas, custoTotalDosItens };
