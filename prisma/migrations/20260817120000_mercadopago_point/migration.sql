-- AlterTable
ALTER TABLE "Caixa" ADD COLUMN "mpAccessTokenEnc" TEXT;
ALTER TABLE "Caixa" ADD COLUMN "mpUserId" TEXT;
ALTER TABLE "Caixa" ADD COLUMN "mpNicknameConta" TEXT;
ALTER TABLE "Caixa" ADD COLUMN "mpDeviceId" TEXT;

-- CreateEnum
CREATE TYPE "StatusPagamentoPointMP" AS ENUM ('PENDENTE', 'EM_PROCESSO', 'APROVADO', 'REJEITADO', 'CANCELADO');

-- CreateTable
CREATE TABLE "PagamentoPointMP" (
    "id" SERIAL NOT NULL,
    "vendaId" INTEGER NOT NULL,
    "caixaId" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "paymentIntentId" TEXT NOT NULL,
    "status" "StatusPagamentoPointMP" NOT NULL DEFAULT 'PENDENTE',
    "valor" DECIMAL(12,2) NOT NULL,
    "detalhes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PagamentoPointMP_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoPointMP_vendaId_key" ON "PagamentoPointMP"("vendaId");

-- CreateIndex
CREATE UNIQUE INDEX "PagamentoPointMP_paymentIntentId_key" ON "PagamentoPointMP"("paymentIntentId");

-- AddForeignKey
ALTER TABLE "PagamentoPointMP" ADD CONSTRAINT "PagamentoPointMP_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PagamentoPointMP" ADD CONSTRAINT "PagamentoPointMP_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
