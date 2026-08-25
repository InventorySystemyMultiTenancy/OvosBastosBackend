-- CreateEnum
CREATE TYPE "StatusSessaoCaixa" AS ENUM ('ABERTA', 'FECHADA');

-- CreateTable
CREATE TABLE "SessaoCaixa" (
    "id" SERIAL NOT NULL,
    "caixaId" INTEGER NOT NULL,
    "status" "StatusSessaoCaixa" NOT NULL DEFAULT 'ABERTA',
    "usuarioAberturaId" INTEGER NOT NULL,
    "valorAbertura" DECIMAL(12,2) NOT NULL,
    "abertaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioFechamentoId" INTEGER,
    "valorFechamento" DECIMAL(12,2),
    "fechadaEm" TIMESTAMP(3),
    "observacaoFechamento" TEXT,
    "valorEsperadoAbertura" DECIMAL(12,2),
    "divergenciaAbertura" DECIMAL(12,2),
    "divergenciaRevisada" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SessaoCaixa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessaoCaixa_caixaId_status_idx" ON "SessaoCaixa"("caixaId", "status");

-- CreateIndex
CREATE INDEX "SessaoCaixa_caixaId_fechadaEm_idx" ON "SessaoCaixa"("caixaId", "fechadaEm");

-- AddForeignKey
ALTER TABLE "SessaoCaixa" ADD CONSTRAINT "SessaoCaixa_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoCaixa" ADD CONSTRAINT "SessaoCaixa_usuarioAberturaId_fkey" FOREIGN KEY ("usuarioAberturaId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessaoCaixa" ADD CONSTRAINT "SessaoCaixa_usuarioFechamentoId_fkey" FOREIGN KEY ("usuarioFechamentoId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
