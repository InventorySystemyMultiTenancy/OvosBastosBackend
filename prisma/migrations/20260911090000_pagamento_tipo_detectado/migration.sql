-- Guarda o tipo real do meio de pagamento (ex: credit_card / debit_card) retornado pelo
-- Mercado Pago quando uma cobrança na maquininha é aprovada, pra alimentar o fechamento do dia.

-- AlterTable
ALTER TABLE "PagamentoPointMP" ADD COLUMN "tipoPagamentoDetectado" TEXT;
