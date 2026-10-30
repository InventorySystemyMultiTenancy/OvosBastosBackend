-- Custo por grão-base (ex: 1 ovo) precisa de mais de 2 casas: R$ 192,00 a caixa de 360 = R$ 0,5333
-- por ovo, que com 2 casas virava 0,53 e a caixa passava a custar R$ 190,80.
ALTER TABLE "Produto" ALTER COLUMN "precoCusto" SET DATA TYPE DECIMAL(12,4);
ALTER TABLE "ItemVenda" ALTER COLUMN "custoUnit" SET DATA TYPE DECIMAL(12,4);
