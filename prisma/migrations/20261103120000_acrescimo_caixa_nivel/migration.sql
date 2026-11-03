-- CreateTable
CREATE TABLE "AcrescimoCaixaNivel" (
    "id" SERIAL NOT NULL,
    "caixaId" INTEGER NOT NULL,
    "nivelVendaId" INTEGER NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AcrescimoCaixaNivel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AcrescimoCaixaNivel_caixaId_nivelVendaId_key" ON "AcrescimoCaixaNivel"("caixaId", "nivelVendaId");

-- AddForeignKey
ALTER TABLE "AcrescimoCaixaNivel" ADD CONSTRAINT "AcrescimoCaixaNivel_caixaId_fkey" FOREIGN KEY ("caixaId") REFERENCES "Caixa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcrescimoCaixaNivel" ADD CONSTRAINT "AcrescimoCaixaNivel_nivelVendaId_fkey" FOREIGN KEY ("nivelVendaId") REFERENCES "NivelVendaProduto"("id") ON DELETE CASCADE ON UPDATE CASCADE;
