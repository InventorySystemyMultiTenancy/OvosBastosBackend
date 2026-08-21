-- CreateTable
CREATE TABLE "AnaliseReposicaoIA" (
    "id" SERIAL NOT NULL,
    "data" DATE NOT NULL,
    "resumo" TEXT,
    "itens" JSONB NOT NULL,
    "modelo" TEXT,
    "geradoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnaliseReposicaoIA_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnaliseReposicaoIA_data_key" ON "AnaliseReposicaoIA"("data");
