const prisma = require('../../config/db');

const INCLUDE_PADRAO = {
  cliente: true,
  vendedor: { select: { id: true, nome: true } },
  caixa: { select: { id: true, nome: true, unidade: true, ativo: true } },
  itens: { include: { produto: true } },
  pagamentoPointMP: true,
};

function calcularTotal(itensComPreco, desconto) {
  const bruto = itensComPreco.reduce((soma, i) => soma + i.quantidade * Number(i.precoUnit), 0);
  return Math.max(bruto - Number(desconto || 0), 0);
}

async function processarCheckout({ clienteId, vendedorId, caixaId, itens, formaPagamento, vencimento, desconto = 0, origemMotivo }) {
  if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
    throw Object.assign(new Error('clienteId e ao menos um item são obrigatórios'), { status: 400 });
  }
  if (!formaPagamento) {
    throw Object.assign(new Error('formaPagamento é obrigatória'), { status: 400 });
  }

  if (caixaId) {
    const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) } });
    if (!caixa || !caixa.ativo) {
      throw Object.assign(new Error('Caixa/unidade inválido'), { status: 400 });
    }
  }

  const produtos = await prisma.produto.findMany({
    where: { id: { in: itens.map((i) => Number(i.produtoId)) } },
  });

  const itensComPreco = itens.map((i) => {
    const produto = produtos.find((p) => p.id === Number(i.produtoId));
    if (!produto || !produto.ativo) {
      throw Object.assign(new Error(`Produto ${i.produtoId} não encontrado`), { status: 400 });
    }
    const quantidade = Number(i.quantidade);
    if (!quantidade || quantidade <= 0) {
      throw Object.assign(new Error(`Quantidade inválida para "${produto.nome}"`), { status: 400 });
    }
    if (produto.quantidade < quantidade) {
      throw Object.assign(new Error(`Estoque insuficiente para "${produto.nome}"`), { status: 400 });
    }
    return { produtoId: produto.id, quantidade, precoUnit: produto.precoVenda, nome: produto.nome };
  });

  const total = calcularTotal(itensComPreco, desconto);

  if (formaPagamento === 'FIADO') {
    const cliente = await prisma.cliente.findUnique({ where: { id: clienteId } });
    const devedorAtual = await prisma.contaReceber.aggregate({
      where: { clienteId, pago: false },
      _sum: { valor: true },
    });
    const saldoDevedor = Number(devedorAtual._sum.valor || 0);
    const limite = Number(cliente.limiteCredito);
    if (saldoDevedor + total > limite) {
      throw Object.assign(new Error('Limite de crédito do cliente excedido'), { status: 400 });
    }
  }

  const venda = await prisma.$transaction(async (tx) => {
    const novaVenda = await tx.venda.create({
      data: {
        clienteId,
        vendedorId: vendedorId || null,
        caixaId: caixaId ? Number(caixaId) : null,
        status: 'CONFIRMADA',
        formaPagamento,
        desconto,
        total,
        confirmadaEm: new Date(),
        itens: { create: itensComPreco.map(({ produtoId, quantidade, precoUnit }) => ({ produtoId, quantidade, precoUnit })) },
      },
    });

    for (const item of itensComPreco) {
      await tx.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: item.quantidade } } });
      await tx.movimentacaoEstoque.create({
        data: {
          produtoId: item.produtoId,
          tipo: 'SAIDA',
          quantidade: item.quantidade,
          motivo: origemMotivo ? `${origemMotivo} #${novaVenda.id}` : `Venda #${novaVenda.id}`,
        },
      });
    }

    if (formaPagamento === 'FIADO') {
      await tx.contaReceber.create({
        data: {
          clienteId,
          vendaId: novaVenda.id,
          caixaId: caixaId ? Number(caixaId) : null,
          valor: total,
          vencimento: vencimento ? new Date(vencimento) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });
    }

    return novaVenda;
  });

  return prisma.venda.findUnique({ where: { id: venda.id }, include: INCLUDE_PADRAO });
}

async function confirmarVenda(vendaId, { formaPagamento, vencimento }) {
  const id = Number(vendaId);
  if (!formaPagamento) {
    throw Object.assign(new Error('formaPagamento é obrigatória'), { status: 400 });
  }

  const venda = await prisma.venda.findUnique({ where: { id }, include: { itens: true, cliente: true } });
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada'), { status: 404 });
  }
  if (venda.status !== 'ORCAMENTO') {
    throw Object.assign(new Error('Somente orçamentos podem ser confirmados'), { status: 400 });
  }

  for (const item of venda.itens) {
    const produto = await prisma.produto.findUnique({ where: { id: item.produtoId } });
    if (produto.quantidade < item.quantidade) {
      throw Object.assign(new Error(`Estoque insuficiente para o produto "${produto.nome}"`), { status: 400 });
    }
  }

  if (formaPagamento === 'FIADO') {
    const devedorAtual = await prisma.contaReceber.aggregate({
      where: { clienteId: venda.clienteId, pago: false },
      _sum: { valor: true },
    });
    const saldoDevedor = Number(devedorAtual._sum.valor || 0);
    const limite = Number(venda.cliente.limiteCredito);
    if (saldoDevedor + Number(venda.total) > limite) {
      throw Object.assign(new Error('Limite de crédito do cliente excedido'), { status: 400 });
    }
  }

  const operacoes = [
    prisma.venda.update({
      where: { id },
      data: { status: 'CONFIRMADA', formaPagamento, confirmadaEm: new Date() },
    }),
    ...venda.itens.flatMap((item) => [
      prisma.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: item.quantidade } } }),
      prisma.movimentacaoEstoque.create({
        data: { produtoId: item.produtoId, tipo: 'SAIDA', quantidade: item.quantidade, motivo: `Venda #${id}` },
      }),
    ]),
  ];

  if (formaPagamento === 'FIADO') {
    operacoes.push(
      prisma.contaReceber.create({
        data: {
          clienteId: venda.clienteId,
          vendaId: id,
          caixaId: venda.caixaId,
          valor: venda.total,
          vencimento: vencimento ? new Date(vencimento) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      })
    );
  }

  await prisma.$transaction(operacoes);

  return prisma.venda.findUnique({ where: { id }, include: INCLUDE_PADRAO });
}

module.exports = { INCLUDE_PADRAO, calcularTotal, processarCheckout, confirmarVenda };
