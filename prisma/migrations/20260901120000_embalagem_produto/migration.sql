-- "Caixa" comercial (ex: caixa com 30 bandejas) — sem estoque próprio, desconta direto do
-- estoque do Produto na venda. Nome EmbalagemProduto de propósito, pra não colidir com o
-- model Caixa (registro/unidade de venda).

-- CreateTable
CREATE TABLE "EmbalagemProduto" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "quantidadeBandejas" INTEGER NOT NULL,
    "preco" DECIMAL(12,2) NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmbalagemProduto_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "ItemVenda" ADD COLUMN "embalagemId" INTEGER,
ADD COLUMN "bandejasPorEmbalagem" INTEGER;

-- AddForeignKey
ALTER TABLE "EmbalagemProduto" ADD CONSTRAINT "EmbalagemProduto_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemVenda" ADD CONSTRAINT "ItemVenda_embalagemId_fkey" FOREIGN KEY ("embalagemId") REFERENCES "EmbalagemProduto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
