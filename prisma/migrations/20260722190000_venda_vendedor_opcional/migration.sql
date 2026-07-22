-- AlterTable
ALTER TABLE "Venda" ALTER COLUMN "vendedorId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "Venda" DROP CONSTRAINT "Venda_vendedorId_fkey";

-- AddForeignKey
ALTER TABLE "Venda" ADD CONSTRAINT "Venda_vendedorId_fkey" FOREIGN KEY ("vendedorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
