-- Venda de unidade individual (ex: ovo avulso) abaixo da "unidade" normal do produto
-- (dúzia/bandeja), e foto própria pra caixa/embalagem no PDV.

-- AlterTable
ALTER TABLE "Produto" ADD COLUMN "unidadesPorPacote" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "EmbalagemProduto" ADD COLUMN "imagemUrl" TEXT;

-- AlterTable
ALTER TABLE "ItemVenda" ADD COLUMN "vendidoPorUnidade" BOOLEAN NOT NULL DEFAULT false;
