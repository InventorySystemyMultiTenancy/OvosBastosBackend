const prisma = require('../../config/db');

const INCLUDE_PADRAO = {
  fornecedor: true,
  criadoPor: { select: { id: true, nome: true } },
  itens: { include: { produto: true } },
  pagamentos: { orderBy: { createdAt: 'desc' } },
};

async function listar() {
  return prisma.recebimento.findMany({ include: INCLUDE_PADRAO, orderBy: { createdAt: 'desc' } });
}

async function obter(id) {
  const recebimento = await prisma.recebimento.findUnique({ where: { id: Number(id) }, include: INCLUDE_PADRAO });
  if (!recebimento) {
    throw Object.assign(new Error('Recebimento não encontrado'), { status: 404 });
  }
  return recebimento;
}

async function criar({ itens, observacao, criadoPorId }) {
  if (!Array.isArray(itens)) {
    throw Object.assign(new Error('itens é obrigatório'), { status: 400 });
  }

  const itensValidos = itens
    .map((i) => ({ produtoId: Number(i.produtoId), quantidade: Number(i.quantidade) }))
    .filter((i) => i.produtoId && i.quantidade > 0);

  if (itensValidos.length === 0) {
    throw Object.assign(new Error('Informe ao menos um produto com quantidade recebida'), { status: 400 });
  }

  const produtos = await prisma.produto.findMany({ where: { id: { in: itensValidos.map((i) => i.produtoId) } } });
  for (const item of itensValidos) {
    const produto = produtos.find((p) => p.id === item.produtoId);
    if (!produto || !produto.ativo) {
      throw Object.assign(new Error(`Produto ${item.produtoId} não encontrado`), { status: 400 });
    }
  }

  const recebimentoId = await prisma.$transaction(async (tx) => {
    const recebimento = await tx.recebimento.create({
      data: {
        observacao: observacao || null,
        criadoPorId: criadoPorId || null,
        itens: { create: itensValidos.map((i) => ({ produtoId: i.produtoId, quantidadeRecebida: i.quantidade })) },
      },
    });

    for (const item of itensValidos) {
      await tx.produto.update({ where: { id: item.produtoId }, data: { quantidade: { increment: item.quantidade } } });
      await tx.movimentacaoEstoque.create({
        data: {
          produtoId: item.produtoId,
          caixaId: null,
          tipo: 'ENTRADA',
          quantidade: item.quantidade,
          motivo: `Recebimento #${recebimento.id}`,
        },
      });
    }

    return recebimento.id;
  });

  return obter(recebimentoId);
}

async function definirFornecedor(id, fornecedorId) {
  if (!fornecedorId) {
    throw Object.assign(new Error('fornecedorId é obrigatório'), { status: 400 });
  }

  const recebimento = await prisma.recebimento.findUnique({ where: { id: Number(id) }, include: { itens: true } });
  if (!recebimento) {
    throw Object.assign(new Error('Recebimento não encontrado'), { status: 404 });
  }
  if (recebimento.status !== 'EM_ANDAMENTO') {
    throw Object.assign(new Error('Este recebimento já teve o fornecedor definido'), { status: 400 });
  }

  const fornecedor = await prisma.fornecedor.findUnique({ where: { id: Number(fornecedorId) } });
  if (!fornecedor || !fornecedor.ativo) {
    throw Object.assign(new Error('Fornecedor inválido'), { status: 400 });
  }

  // Trava o valor devido nesse momento (itens × preço cadastrado do fornecedor). Produto
  // sem preço cadastrado contribui 0 — editar a tabela de preços depois não reabre esse total.
  const precos = await prisma.precoFornecedor.findMany({ where: { fornecedorId: fornecedor.id } });
  const mapaPrecos = new Map(precos.map((p) => [p.produtoId, Number(p.precoUnitario)]));
  const valorTotal = recebimento.itens.reduce(
    (soma, item) => soma + item.quantidadeRecebida * (mapaPrecos.get(item.produtoId) || 0),
    0
  );

  await prisma.recebimento.update({
    where: { id: Number(id) },
    data: { fornecedorId: fornecedor.id, status: 'AGUARDANDO_DISTRIBUICAO', finalizadoEm: new Date(), valorTotal },
  });

  return obter(id);
}

async function pagar(id, valor) {
  const valorNum = Number(valor);
  if (!valorNum || valorNum <= 0) {
    throw Object.assign(new Error('valor deve ser maior que zero'), { status: 400 });
  }

  const recebimento = await prisma.recebimento.findUnique({ where: { id: Number(id) } });
  if (!recebimento) {
    throw Object.assign(new Error('Recebimento não encontrado'), { status: 404 });
  }
  if (recebimento.status === 'EM_ANDAMENTO' || recebimento.valorTotal === null) {
    throw Object.assign(new Error('Defina o fornecedor antes de registrar pagamentos'), { status: 400 });
  }

  const restante = Number(recebimento.valorTotal) - Number(recebimento.valorPago);
  if (valorNum > restante) {
    throw Object.assign(
      new Error(`Valor (${valorNum}) excede o restante devido (${restante})`),
      { status: 400 }
    );
  }

  await prisma.$transaction([
    prisma.pagamentoRecebimento.create({ data: { recebimentoId: recebimento.id, valor: valorNum } }),
    prisma.recebimento.update({ where: { id: recebimento.id }, data: { valorPago: { increment: valorNum } } }),
  ]);

  return obter(id);
}

async function distribuir(id, distribuicoes) {
  if (!Array.isArray(distribuicoes) || distribuicoes.length === 0) {
    throw Object.assign(new Error('distribuicoes é obrigatório'), { status: 400 });
  }

  const recebimento = await prisma.recebimento.findUnique({
    where: { id: Number(id) },
    include: { itens: true },
  });
  if (!recebimento) {
    throw Object.assign(new Error('Recebimento não encontrado'), { status: 404 });
  }
  if (recebimento.status === 'EM_ANDAMENTO') {
    throw Object.assign(new Error('Defina o fornecedor antes de distribuir'), { status: 400 });
  }
  if (recebimento.status === 'CONCLUIDO') {
    throw Object.assign(new Error('Este recebimento já foi totalmente distribuído'), { status: 400 });
  }

  // Soma duplicatas do mesmo (produtoId, caixaId) recebidas na mesma chamada.
  const mapaLinhas = new Map();
  for (const linha of distribuicoes) {
    const produtoId = Number(linha.produtoId);
    const caixaId = Number(linha.caixaId);
    const quantidade = Number(linha.quantidade);
    if (!produtoId || !caixaId || !quantidade || quantidade <= 0) continue;
    const chave = `${produtoId}-${caixaId}`;
    mapaLinhas.set(chave, {
      produtoId,
      caixaId,
      quantidade: (mapaLinhas.get(chave)?.quantidade || 0) + quantidade,
    });
  }
  const linhas = Array.from(mapaLinhas.values());
  if (linhas.length === 0) {
    throw Object.assign(new Error('Informe ao menos uma quantidade para distribuir'), { status: 400 });
  }

  const restantePorProduto = new Map(
    recebimento.itens.map((item) => [item.produtoId, item.quantidadeRecebida - item.quantidadeDistribuida])
  );
  const totalPorProduto = new Map();
  for (const linha of linhas) {
    totalPorProduto.set(linha.produtoId, (totalPorProduto.get(linha.produtoId) || 0) + linha.quantidade);
  }
  for (const [produtoId, total] of totalPorProduto) {
    const restante = restantePorProduto.get(produtoId);
    if (restante === undefined) {
      throw Object.assign(new Error(`Produto ${produtoId} não faz parte deste recebimento`), { status: 400 });
    }
    if (total > restante) {
      throw Object.assign(
        new Error(`Quantidade a distribuir do produto ${produtoId} (${total}) excede o restante disponível (${restante})`),
        { status: 400 }
      );
    }
  }

  const caixas = await prisma.caixa.findMany({ where: { id: { in: linhas.map((l) => l.caixaId) } } });
  for (const linha of linhas) {
    const caixa = caixas.find((c) => c.id === linha.caixaId);
    if (!caixa || !caixa.ativo) {
      throw Object.assign(new Error(`Unidade ${linha.caixaId} inválida`), { status: 400 });
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const linha of linhas) {
      await tx.itemRecebimento.update({
        where: { recebimentoId_produtoId: { recebimentoId: recebimento.id, produtoId: linha.produtoId } },
        data: { quantidadeDistribuida: { increment: linha.quantidade } },
      });
      await tx.produto.update({ where: { id: linha.produtoId }, data: { quantidade: { decrement: linha.quantidade } } });
      await tx.estoqueCaixa.upsert({
        where: { produtoId_caixaId: { produtoId: linha.produtoId, caixaId: linha.caixaId } },
        create: { produtoId: linha.produtoId, caixaId: linha.caixaId, quantidade: linha.quantidade },
        update: { quantidade: { increment: linha.quantidade } },
      });
      await tx.movimentacaoEstoque.create({
        data: {
          produtoId: linha.produtoId,
          caixaId: linha.caixaId,
          tipo: 'ENTRADA',
          quantidade: linha.quantidade,
          motivo: `Distribuição recebimento #${recebimento.id}`,
        },
      });
    }

    const itensAtualizados = await tx.itemRecebimento.findMany({ where: { recebimentoId: recebimento.id } });
    const totalmenteDistribuido = itensAtualizados.every((item) => item.quantidadeDistribuida >= item.quantidadeRecebida);
    if (totalmenteDistribuido) {
      await tx.recebimento.update({ where: { id: recebimento.id }, data: { status: 'CONCLUIDO', distribuidoEm: new Date() } });
    }
  });

  return obter(id);
}

module.exports = { listar, obter, criar, definirFornecedor, distribuir, pagar };
