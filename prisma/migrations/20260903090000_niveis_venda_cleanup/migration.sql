-- Passo 3/3 (limpeza) da migração pra "níveis de venda" por produto.
--
-- Só aplicada depois de confirmar: todos os produtos têm nível base
-- (NivelVendaProduto com ehBase=true) e todo ItemVenda tem quantidadeGraoPorNivel
-- preenchido — ver backfillNiveisVenda.js, já rodado.

ALTER TABLE "Produto" DROP COLUMN "unidade",
DROP COLUMN "precoVenda",
DROP COLUMN "unidadesPorPacote";

ALTER TABLE "ItemVenda" DROP COLUMN "vendidoPorUnidade",
DROP COLUMN "bandejasPorEmbalagem";

ALTER TABLE "ItemVenda" ALTER COLUMN "quantidadeGraoPorNivel" SET NOT NULL;
