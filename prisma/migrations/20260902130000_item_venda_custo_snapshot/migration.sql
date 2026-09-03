-- ItemVenda.custoUnit: snapshot de Produto.precoCusto (por grão-base) no momento da venda.
-- Sem isso, editar o custo de um produto num recebimento novo mudava retroativamente o
-- custo (e o Lucro Líquido) de vendas já feitas com o estoque antigo, mais barato.
--
-- Aditiva (coluna nullable) — depois de rodar, backfillCustoUnit.js preenche o histórico
-- usando o Produto.precoCusto atual como melhor estimativa pra vendas de antes desta coluna
-- existir (não tem como recuperar o custo exato de cada venda antiga retroativamente).

ALTER TABLE "ItemVenda" ADD COLUMN "custoUnit" DECIMAL(12,2);
