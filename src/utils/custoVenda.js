// Compartilhado entre dashboard.controller.js e financeiro.controller.js — os dois precisam
// do mesmo cálculo de "quanto isso vendeu de verdade" e "quanto isso custou" pra que o Lucro
// Líquido bata igual em qualquer tela que o mostre.

// quantidadeGraoPorNivel é o snapshot (travado na venda) de quantas unidades do grão-base
// (ex: 1 ovo) o nível vendido (Unidade/Dúzia/Bandeja/Caixa) representa — ver
// NivelVendaProduto/ItemVenda no schema. Basta multiplicar pela quantidade de linhas vendidas
// pra converter qualquer item pro grão-base, não importa o nível escolhido.
function unidadesVendidas(item) {
  return item.quantidade * item.quantidadeGraoPorNivel;
}

// Soma o custo (Produto.precoCusto, já em grão-base) de uma lista de itens de venda. Item sem
// precoCusto cadastrado não entra na soma (custo desconhecido != zero) — é assim que o Lucro
// Líquido desconta custo de produto, não só despesas operacionais.
function custoTotalDosItens(itens) {
  return itens.reduce((soma, i) => {
    if (i.produto.precoCusto === null) return soma;
    return soma + Number(i.produto.precoCusto) * unidadesVendidas(i);
  }, 0);
}

module.exports = { unidadesVendidas, custoTotalDosItens };
