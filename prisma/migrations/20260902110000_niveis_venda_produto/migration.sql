-- Passo 1/3 (aditivo) da migração pra "níveis de venda" (unidade/dúzia/bandeja/caixa) por
-- produto. Generaliza EmbalagemProduto (hoje só "caixa fechada") pra cobrir também o que hoje
-- é Produto.unidade+precoVenda e a venda por unidade avulsa (Produto.unidadesPorPacote).
--
-- Este passo só ADICIONA estrutura — não apaga nem preenche nada ainda. Depois de rodar esta
-- migração, rode o script de backfill (scripts/backfillNiveisVenda.js) pra popular os novos
-- campos a partir dos dados existentes; só então a migração de limpeza (passo 3) pode rodar
-- pra remover as colunas antigas.

-- RenameTable
ALTER TABLE "EmbalagemProduto" RENAME TO "NivelVendaProduto";

-- RenameColumn (quantidadeBandejas passa a significar grão-base, não mais "quantidade de
-- Produto.unidade" — o backfill corrige o VALOR das linhas existentes)
ALTER TABLE "NivelVendaProduto" RENAME COLUMN "quantidadeBandejas" TO "quantidadeGrao";

-- AlterTable
ALTER TABLE "NivelVendaProduto" ADD COLUMN "ehBase" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "precoManual" BOOLEAN NOT NULL DEFAULT false;

-- RenameColumn
ALTER TABLE "ItemVenda" RENAME COLUMN "embalagemId" TO "nivelVendaId";

-- AlterTable
ALTER TABLE "ItemVenda" ADD COLUMN "quantidadeGraoPorNivel" INTEGER;
