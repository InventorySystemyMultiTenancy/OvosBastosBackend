require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const senhaHash = await bcrypt.hash('admin123', 10);

  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@eggcontrol.com' },
    update: {},
    create: { nome: 'Administrador', email: 'admin@eggcontrol.com', senhaHash, perfil: 'ADMIN' },
  });

  await prisma.usuario.upsert({
    where: { email: 'vendedor@eggcontrol.com' },
    update: {},
    create: { nome: 'Vendedor Exemplo', email: 'vendedor@eggcontrol.com', senhaHash, perfil: 'VENDEDOR' },
  });

  await prisma.usuario.upsert({
    where: { email: 'entregador@eggcontrol.com' },
    update: {},
    create: { nome: 'Entregador Exemplo', email: 'entregador@eggcontrol.com', senhaHash, perfil: 'ENTREGADOR' },
  });

  const clientesSeed = [
    { nome: 'Mercado São José', cidade: 'São Paulo', limiteCredito: 2000 },
    { nome: 'Padaria Central', cidade: 'São Paulo', limiteCredito: 1000 },
    { nome: 'Supermercado Norte', cidade: 'Guarulhos', limiteCredito: 5000 },
    { nome: 'Restaurante Sol', cidade: 'São Paulo', limiteCredito: 800 },
  ];

  for (const c of clientesSeed) {
    const existente = await prisma.cliente.findFirst({ where: { nome: c.nome } });
    if (!existente) {
      await prisma.cliente.create({ data: { ...c, bandeja: { create: {} } } });
    }
  }

  const produtosSeed = [
    { nome: 'Ovo Branco Grande (dúzia)', tipo: 'branco', precoVenda: 9.9, precoCusto: 6.5, quantidade: 500, estoqueMinimo: 100 },
    { nome: 'Ovo Vermelho Grande (dúzia)', tipo: 'vermelho', precoVenda: 10.9, precoCusto: 7.2, quantidade: 400, estoqueMinimo: 100 },
    { nome: 'Ovo Caipira (dúzia)', tipo: 'caipira', precoVenda: 14.9, precoCusto: 10.0, quantidade: 150, estoqueMinimo: 50 },
  ];

  for (const p of produtosSeed) {
    const existente = await prisma.produto.findFirst({ where: { nome: p.nome } });
    if (!existente) {
      await prisma.produto.create({ data: p });
    }
  }

  console.log('Seed concluído. Login admin: admin@eggcontrol.com / admin123');
  console.log(`Usuário admin id=${admin.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
