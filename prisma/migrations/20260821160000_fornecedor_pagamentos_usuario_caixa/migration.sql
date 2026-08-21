-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "caixaId" INTEGER;

-- AlterTable
ALTER TABLE "Recebimento" ADD COLUMN "valorTotal" DECIMAL(12,2);
ALTER TABLE "Recebimento" ADD COLUMN "valorPago" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PrecoFornecedor" (
    "id" SERIAL NOT NULL,
    "fornecedorId" INTEGER NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "precoUnitario" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrecoFornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PagamentoRecebimento" (
    "id" SERIAL NOT NULL,
    "recebimentoId" INTEGER NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PagamentoRecebimento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrecoFornecedor_fornecedorId_produtoId_key" ON "PrecoFornecedor"("fornecedorId", "produtoId");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecoFornecedor" ADD CONSTRAINT "PrecoFornecedor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrecoFornecedor" ADD CONSTRAINT "PrecoFornecedor_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoRecebimento" ADD CONSTRAINT "PagamentoRecebimento_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "Recebimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
