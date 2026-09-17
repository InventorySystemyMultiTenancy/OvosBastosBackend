-- Débito/crédito de uma venda CARTAO lançada manualmente (paga na maquininha por fora do
-- sistema, ex: quando a internet caiu) — pra entrar certinho no fechamento do dia em vez de
-- cair em "outro" por falta de PagamentoPointMP associado.

-- CreateEnum
CREATE TYPE "TipoCartaoManual" AS ENUM ('CREDITO', 'DEBITO');

-- AlterTable
ALTER TABLE "Venda" ADD COLUMN "tipoCartaoManual" "TipoCartaoManual";
