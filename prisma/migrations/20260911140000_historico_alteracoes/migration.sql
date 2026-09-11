-- Rastreia quem fez cada ajuste manual de estoque, e adiciona uma trilha de auditoria genérica
-- pra edições no catálogo de produtos (nome, preço de custo, preço de cada nível de venda).

-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN "usuarioId" INTEGER;

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "HistoricoAlteracao" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" INTEGER NOT NULL,
    "campo" TEXT NOT NULL,
    "valorAntigo" TEXT,
    "valorNovo" TEXT,
    "usuarioId" INTEGER,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricoAlteracao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistoricoAlteracao_produtoId_createdAt_idx" ON "HistoricoAlteracao"("produtoId", "createdAt");

-- AddForeignKey
ALTER TABLE "HistoricoAlteracao" ADD CONSTRAINT "HistoricoAlteracao_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HistoricoAlteracao" ADD CONSTRAINT "HistoricoAlteracao_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
