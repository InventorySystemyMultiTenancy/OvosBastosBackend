-- Código de barras próprio de cada nível de venda (a Dúzia tem uma etiqueta diferente da
-- Bandeja, por exemplo) — bipado no caixa com o leitor pra adicionar direto ao carrinho.

-- AlterTable
ALTER TABLE "NivelVendaProduto" ADD COLUMN "codigoBarras" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "NivelVendaProduto_codigoBarras_key" ON "NivelVendaProduto"("codigoBarras");
