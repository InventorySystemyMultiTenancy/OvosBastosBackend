-- Oposto do desconto: soma ao total do pedido em vez de subtrair.

-- AlterTable
ALTER TABLE "Venda" ADD COLUMN "acrescimo" DECIMAL(12,2) NOT NULL DEFAULT 0;
