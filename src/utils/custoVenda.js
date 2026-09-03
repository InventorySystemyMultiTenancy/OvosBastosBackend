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

// Soma o custo de uma lista de itens de venda, usando SEMPRE o custo travado na própria venda
// (ItemVenda.custoUnit, por grão-base) — nunca o Produto.precoCusto atual. Assim, mudar o
// custo de um produto num recebimento novo (preço novo do fornecedor) não muda
// retroativamente o custo — nem o Lucro Líquido — de vendas já feitas com o estoque antigo,
// mais barato; cada venda sempre é calculada a partir do custo que valia quando ela aconteceu.
// Item sem custo travado não entra na soma (custo desconhecido != zero).
function custoTotalDosItens(itens) {
  return itens.reduce((soma, i) => {
    if (i.custoUnit === null || i.custoUnit === undefined) return soma;
    return soma + Number(i.custoUnit) * unidadesVendidas(i);
  }, 0);
}

module.exports = { unidadesVendidas, custoTotalDosItens };
