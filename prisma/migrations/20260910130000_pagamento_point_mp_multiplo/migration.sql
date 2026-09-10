-- Permite mais de uma cobrança de maquininha por venda (pagamento dividido entre
-- débito e crédito, enviado em duas requisições sequenciais pro mesmo terminal).

-- DropIndex
DROP INDEX "PagamentoPointMP_vendaId_key";

-- CreateIndex
CREATE INDEX "PagamentoPointMP_vendaId_status_idx" ON "PagamentoPointMP"("vendaId", "status");
