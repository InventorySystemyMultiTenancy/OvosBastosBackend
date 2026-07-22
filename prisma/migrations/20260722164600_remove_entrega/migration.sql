-- DropForeignKey
ALTER TABLE "Entrega" DROP CONSTRAINT "Entrega_entregadorId_fkey";

-- DropForeignKey
ALTER TABLE "Entrega" DROP CONSTRAINT "Entrega_vendaId_fkey";

-- DropTable
DROP TABLE "Entrega";

-- DropEnum
DROP TYPE "StatusEntrega";

