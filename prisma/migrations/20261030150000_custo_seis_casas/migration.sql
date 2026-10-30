-- 4 casas ainda arredondava o custo por ovo: R$ 133,00 / 360 = 0,369444..., que com 4 casas
-- voltava como R$ 132,98 a caixa. Com 6 casas a caixa fecha certinho nos centavos.
ALTER TABLE "Produto" ALTER COLUMN "precoCusto" SET DATA TYPE DECIMAL(14,6);
ALTER TABLE "ItemVenda" ALTER COLUMN "custoUnit" SET DATA TYPE DECIMAL(14,6);
