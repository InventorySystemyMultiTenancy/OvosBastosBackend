const prisma = require('../../config/db');

async function encontrarOuCriarClientePorNome(nome) {
  const nomeLimpo = (nome || '').trim();
  if (!nomeLimpo) {
    throw Object.assign(new Error('Nome é obrigatório'), { status: 400 });
  }

  const existente = await prisma.cliente.findFirst({
    where: { nome: { equals: nomeLimpo, mode: 'insensitive' }, ativo: true },
  });
  if (existente) return existente;

  return prisma.cliente.create({
    data: { nome: nomeLimpo, bandeja: { create: {} } },
  });
}

module.exports = { encontrarOuCriarClientePorNome };
