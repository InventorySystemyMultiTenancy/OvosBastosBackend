// Apaga permanentemente do banco as vendas registradas antes de hoje.
//
// Por padrão roda em modo simulação (só mostra o que faria). Pra apagar de verdade:
//   npm run limpar-vendas-antigas -- --confirmar
//
// Vendas com fiado (ContaReceber) ainda em aberto ficam de fora mesmo com --confirmar —
// apagar a venda apagaria também o registro da dívida que o cliente ainda deve.
//
// Isso NÃO devolve produtos ao estoque: o estoque já reflete essas vendas como vendidas de
// verdade, então continua exatamente como está. Só o histórico da venda (e itens, fiado já
// pago, recibo) é apagado — é IRREVERSÍVEL, sem confirmação extra além da flag.

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const confirmar = process.argv.includes('--confirmar');

function inicioDoDia(data = new Date()) {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  const hoje = inicioDoDia();

  const vendasAntigas = await prisma.venda.findMany({
    where: { createdAt: { lt: hoje } },
    select: {
      id: true,
      status: true,
      createdAt: true,
      total: true,
      contaReceber: { select: { id: true, pago: true, valor: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (vendasAntigas.length === 0) {
    console.log('Nenhuma venda de dias anteriores a hoje encontrada. Nada a fazer.');
    return;
  }

  const bloqueadas = vendasAntigas.filter((v) => v.contaReceber && !v.contaReceber.pago);
  const apagaveis = vendasAntigas.filter((v) => !(v.contaReceber && !v.contaReceber.pago));

  console.log(`Vendas de dias anteriores a hoje (antes de ${hoje.toLocaleDateString('pt-BR')}): ${vendasAntigas.length}`);
  console.log(`  -> ${apagaveis.length} seriam apagadas.`);
  if (bloqueadas.length > 0) {
    console.log(`  -> ${bloqueadas.length} têm fiado ainda em aberto e NÃO serão apagadas (quite a dívida no Financeiro antes, se quiser incluí-las):`);
    bloqueadas.forEach((v) => {
      console.log(`     Venda #${v.id} — ${v.createdAt.toLocaleDateString('pt-BR')} — fiado em aberto: R$ ${Number(v.contaReceber.valor).toFixed(2)}`);
    });
  }

  console.log('\nLembrete: isso não devolve produtos ao estoque — só apaga o histórico da venda, e é irreversível.');

  if (!confirmar) {
    console.log('\nModo simulação — nenhuma alteração foi feita. Pra apagar de verdade:');
    console.log('  npm run limpar-vendas-antigas -- --confirmar');
    return;
  }

  const idsApagar = apagaveis.map((v) => v.id);

  await prisma.$transaction([
    prisma.contaReceber.deleteMany({ where: { vendaId: { in: idsApagar } } }),
    prisma.venda.deleteMany({ where: { id: { in: idsApagar } } }),
  ]);

  console.log(`\n${apagaveis.length} vendas apagadas com sucesso.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
