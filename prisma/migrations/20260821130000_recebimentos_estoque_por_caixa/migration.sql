-- AlterTable
ALTER TABLE "MovimentacaoEstoque" ADD COLUMN "caixaId" INTEGER;

-- CreateEnum
CREATE TYPE "StatusRecebimento" AS ENUM ('EM_ANDAMENTO', 'AGUARDANDO_DISTRIBUICAO', 'CONCLUIDO');

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Fornecedor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recebimento" (
    "id" SERIAL NOT NULL,
    "status" "StatusRecebimento" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "fornecedorId" INTEGER,
    "criadoPorId" INTEGER,
    "observacao" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalizadoEm" TIMESTAMP(3),
    "distribuidoEm" TIMESTAMP(3),

    CONSTRAINT "Recebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemRecebimento" (
    "id" SERIAL NOT NULL,
    "recebimentoId" INTEGER NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "quantidadeRecebida" INTEGER NOT NULL,
    "quantidadeDistribuida" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemRecebimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EstoqueCaixa" (
    "id" SERIAL NOT NULL,
    "produtoId" INTEGER NOT NULL,
    "caixaId" INTEGER NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EstoqueCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItemRecebimento_recebimentoId_produtoId_key" ON "ItemRecebimento"("recebimentoId", "produtoId");

-- CreateIndex
CREATE UNIQUE INDEX "EstoqueCaixa_produtoId_caixaId_key" ON "EstoqueCaixa"("produtoId", "caixaId");

-- AddForeignKey
ALTER TABLE "MovimentacaoEstoque" ADD CONSTRAINT "MovimentacaoEstoque_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recebimento" ADD CONSTRAINT "Recebimento_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRecebimento" ADD CONSTRAINT "ItemRecebimento_recebimentoId_fkey" FOREIGN KEY ("recebimentoId") REFERENCES "Recebimento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemRecebimento" ADD CONSTRAINT "ItemRecebimento_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueCaixa" ADD CONSTRAINT "EstoqueCaixa_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EstoqueCaixa" ADD CONSTRAINT "EstoqueCaixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE CASCADE ON UPDATE CASCADE;
