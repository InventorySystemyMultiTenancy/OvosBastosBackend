-- Login de funcionário passa a ser travado a uma unidade (loja) em vez de um caixa
-- específico, já que agora uma unidade pode ter mais de um caixa físico.

-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN "unidade" TEXT;

-- Preenche a unidade de quem já estava travado a um caixa, a partir do caixa atual —
-- ninguém perde a própria restrição de acesso na troca.
UPDATE "Usuario" u
SET "unidade" = c."unidade"
FROM "Caixa" c
WHERE u."caixaId" = c.id;

-- DropForeignKey
ALTER TABLE "Usuario" DROP CONSTRAINT "Usuario_caixaId_fkey";

-- AlterTable
ALTER TABLE "Usuario" DROP COLUMN "caixaId";
