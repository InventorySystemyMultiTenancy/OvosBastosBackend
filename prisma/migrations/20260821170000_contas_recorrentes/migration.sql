-- AlterTable
ALTER TABLE "ContaReceber" ADD COLUMN "recorrente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContaReceber" ADD COLUMN "origemRecorrenteId" INTEGER;

-- AlterTable
ALTER TABLE "ContaPagar" ADD COLUMN "recorrente" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ContaPagar" ADD COLUMN "origemRecorrenteId" INTEGER;

-- AddForeignKey
ALTER TABLE "ContaReceber" ADD CONSTRAINT "ContaReceber_origemRecorrenteId_fkey" FOREIGN KEY ("origemRecorrenteId") REFERENCES "ContaReceber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContaPagar" ADD CONSTRAINT "ContaPagar_origemRecorrenteId_fkey" FOREIGN KEY ("origemRecorrenteId") REFERENCES "ContaPagar"("id") ON DELETE SET NULL ON UPDATE CASCADE;
