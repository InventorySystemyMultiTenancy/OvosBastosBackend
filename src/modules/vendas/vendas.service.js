const prisma = require('../../config/db');
const { exigirCaixaAberto } = require('../caixas/sessoesCaixa.service');

const INCLUDE_PADRAO = {
  cliente: true,
  vendedor: { select: { id: true, nome: true } },
  caixa: { select: { id: true, nome: true, unidade: true, ativo: true } },
  itens: { include: { produto: true, embalagem: true } },
  pagamentoPointMP: true,
};

function calcularTotal(itensComPreco, desconto, acrescimo = 0) {
  const bruto = itensComPreco.reduce((soma, i) => soma + i.quantidade * Number(i.precoUnit), 0);
  return Math.max(bruto - Number(desconto || 0) + Number(acrescimo || 0), 0);
}

// Quantidade em bandejas que um item de venda realmente tira do estoque do Produto. Item
// normal: quantidade já é em bandejas. Item vendido como embalagem (ex: "1 caixa de 30"):
// quantidade é o número de embalagens, então multiplica pelo tamanho travado na venda —
// embalagem não tem estoque próprio, desconta sempre do mesmo Produto.quantidade/EstoqueCaixa.
function bandejasDoItem(item) {
  return item.embalagemId ? item.quantidade * item.bandejasPorEmbalagem : item.quantidade;
}

async function processarCheckout({ clienteId, vendedorId, caixaId, itens, formaPagamento, vencimento, desconto = 0, acrescimo = 0, valorDinheiro, origemMotivo }) {
  if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
    throw Object.assign(new Error('clienteId e ao menos um item são obrigatórios'), { status: 400 });
  }
  if (!formaPagamento) {
    throw Object.assign(new Error('formaPagamento é obrigatória'), { status: 400 });
  }

  // "MAQUININHA" é um sinalizador do checkout, não um valor válido do enum FormaPagamento:
  // a venda nasce como ORÇAMENTO (sem baixar estoque) e só é confirmada — com formaPagamento
  // "CARTAO" — quando o Mercado Pago aprova o pagamento (ver mercadopago.service.aplicarStatusIntent).
  const viaMaquininha = formaPagamento === 'MAQUININHA';

  // Pagamento dividido: uma parte sai em dinheiro na hora, o restante vai pra maquininha.
  // Só faz sentido junto com MAQUININHA — o valor em dinheiro puro já é a forma "DINHEIRO".
  const valorDinheiroNum = valorDinheiro !== undefined && valorDinheiro !== null ? Number(valorDinheiro) : null;
  if (valorDinheiroNum !== null) {
    if (!viaMaquininha) {
      throw Object.assign(new Error('valorDinheiro só é aceito com pagamento na maquininha'), { status: 400 });
    }
    if (valorDinheiroNum <= 0) {
      throw Object.assign(new Error('valorDinheiro deve ser maior que zero'), { status: 400 });
    }
  }

  if (caixaId) {
    const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) } });
    if (!caixa || !caixa.ativo) {
      throw Object.assign(new Error('Caixa/unidade inválido'), { status: 400 });
    }
    await exigirCaixaAberto(caixaId);
  } else if (viaMaquininha) {
    throw Object.assign(new Error('Selecione um caixa para cobrar na maquininha'), { status: 400 });
  }

  const produtos = await prisma.produto.findMany({
    where: { id: { in: itens.map((i) => Number(i.produtoId)) } },
  });

  const embalagemIds = itens.filter((i) => i.embalagemId).map((i) => Number(i.embalagemId));
  const embalagens = embalagemIds.length
    ? await prisma.embalagemProduto.findMany({ where: { id: { in: embalagemIds } } })
    : [];

  // Com caixa selecionada, a unidade só pode vender o que tem alocado a ela (EstoqueCaixa).
  // Sem caixa (ex.: catálogo online), continua vendendo do pool central (Produto.quantidade).
  const estoquesCaixa = caixaId
    ? await prisma.estoqueCaixa.findMany({
        where: { caixaId: Number(caixaId), produtoId: { in: itens.map((i) => Number(i.produtoId)) } },
      })
    : [];
  const mapaEstoqueCaixa = new Map(estoquesCaixa.map((e) => [e.produtoId, e.quantidade]));

  const itensComPreco = itens.map((i) => {
    const produto = produtos.find((p) => p.id === Number(i.produtoId));
    if (!produto || !produto.ativo) {
      throw Object.assign(new Error(`Produto ${i.produtoId} não encontrado`), { status: 400 });
    }
    const quantidade = Number(i.quantidade);
    if (!quantidade || quantidade <= 0) {
      throw Object.assign(new Error(`Quantidade inválida para "${produto.nome}"`), { status: 400 });
    }

    // Item vendido como "caixa" (embalagem fechada, ex: 30 bandejas por R$X): preço é o da
    // embalagem inteira, e o que desconta do estoque é quantidade × bandejas por embalagem —
    // a embalagem em si não tem estoque separado, sai sempre do mesmo estoque do produto.
    let precoUnit = produto.precoVenda;
    let embalagemId = null;
    let bandejasPorEmbalagem = null;
    if (i.embalagemId) {
      const embalagem = embalagens.find((e) => e.id === Number(i.embalagemId) && e.produtoId === produto.id);
      if (!embalagem || !embalagem.ativo) {
        throw Object.assign(new Error(`Caixa de "${produto.nome}" não encontrada`), { status: 400 });
      }
      precoUnit = embalagem.preco;
      embalagemId = embalagem.id;
      bandejasPorEmbalagem = embalagem.quantidadeBandejas;
    }
    const bandejasNecessarias = bandejasPorEmbalagem ? quantidade * bandejasPorEmbalagem : quantidade;

    const disponivel = caixaId ? mapaEstoqueCaixa.get(produto.id) || 0 : produto.quantidade;
    if (disponivel < bandejasNecessarias) {
      throw Object.assign(
        new Error(`Estoque insuficiente para "${produto.nome}"${caixaId ? ' nesta unidade' : ''}`),
        { status: 400 }
      );
    }
    return { produtoId: produto.id, quantidade, precoUnit, embalagemId, bandejasPorEmbalagem, nome: produto.nome };
  });

  const total = calcularTotal(itensComPreco, desconto, acrescimo);

  if (valorDinheiroNum !== null && valorDinheiroNum >= total) {
    throw Object.assign(new Error('valorDinheiro deve ser menor que o total (o restante vai pra maquininha)'), { status: 400 });
  }

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
        status: viaMaquininha ? 'ORCAMENTO' : 'CONFIRMADA',
        formaPagamento: viaMaquininha ? null : formaPagamento,
        valorDinheiro: valorDinheiroNum,
        desconto,
        acrescimo,
        total,
        confirmadaEm: viaMaquininha ? null : new Date(),
        itens: {
          create: itensComPreco.map(({ produtoId, quantidade, precoUnit, embalagemId, bandejasPorEmbalagem }) => ({
            produtoId,
            quantidade,
            precoUnit,
            embalagemId,
            bandejasPorEmbalagem,
          })),
        },
      },
    });

    if (!viaMaquininha) {
      for (const item of itensComPreco) {
        const bandejas = bandejasDoItem(item);
        if (caixaId) {
          await tx.estoqueCaixa.update({
            where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: Number(caixaId) } },
            data: { quantidade: { decrement: bandejas } },
          });
        } else {
          await tx.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: bandejas } } });
        }
        await tx.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: caixaId ? Number(caixaId) : null,
            tipo: 'SAIDA',
            quantidade: bandejas,
            motivo: origemMotivo ? `${origemMotivo} #${novaVenda.id}` : `Venda #${novaVenda.id}`,
          },
        });
      }
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

  if (venda.caixaId) {
    await exigirCaixaAberto(venda.caixaId);
  }

  for (const item of venda.itens) {
    const produto = await prisma.produto.findUnique({ where: { id: item.produtoId } });
    const disponivel = venda.caixaId
      ? (
          await prisma.estoqueCaixa.findUnique({
            where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
          })
        )?.quantidade || 0
      : produto.quantidade;
    if (disponivel < bandejasDoItem(item)) {
      throw Object.assign(
        new Error(`Estoque insuficiente para o produto "${produto.nome}"${venda.caixaId ? ' nesta unidade' : ''}`),
        { status: 400 }
      );
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
    ...venda.itens.flatMap((item) => {
      const bandejas = bandejasDoItem(item);
      return [
        venda.caixaId
          ? prisma.estoqueCaixa.update({
              where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
              data: { quantidade: { decrement: bandejas } },
            })
          : prisma.produto.update({ where: { id: item.produtoId }, data: { quantidade: { decrement: bandejas } } }),
        prisma.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: venda.caixaId || null,
            tipo: 'SAIDA',
            quantidade: bandejas,
            motivo: `Venda #${id}`,
          },
        }),
      ];
    }),
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

// Desfaz uma venda já CONFIRMADA: devolve o estoque baixado (pro EstoqueCaixa da unidade,
// ou pro pool central se a venda não tinha caixa), apaga a conta a receber se era fiado
// ainda não pago, e volta a venda pra ORCAMENTO sem forma de pagamento — a partir daí ela
// reaparece na lista com os mesmos botões "Confirmar"/"Cancelar" de qualquer orçamento, então
// tanto "reabrir pra trocar a forma de pagamento" quanto "apagar a venda" usam esse mesmo
// caminho (reabrir e, se for o caso, cancelar o orçamento resultante).
async function reabrirVenda(vendaId) {
  const id = Number(vendaId);
  const venda = await prisma.venda.findUnique({ where: { id }, include: { itens: true, contaReceber: true } });
  if (!venda) {
    throw Object.assign(new Error('Venda não encontrada'), { status: 404 });
  }
  if (venda.status !== 'CONFIRMADA') {
    throw Object.assign(new Error('Somente vendas confirmadas podem ser reabertas'), { status: 400 });
  }
  if (venda.contaReceber && venda.contaReceber.pago) {
    throw Object.assign(
      new Error('Esta venda tem uma conta a receber (fiado) já paga — estorne o pagamento no Financeiro antes de reabrir'),
      { status: 400 }
    );
  }

  const operacoes = [
    ...venda.itens.flatMap((item) => {
      const bandejas = bandejasDoItem(item);
      return [
        venda.caixaId
          ? prisma.estoqueCaixa.upsert({
              where: { produtoId_caixaId: { produtoId: item.produtoId, caixaId: venda.caixaId } },
              create: { produtoId: item.produtoId, caixaId: venda.caixaId, quantidade: bandejas },
              update: { quantidade: { increment: bandejas } },
            })
          : prisma.produto.update({ where: { id: item.produtoId }, data: { quantidade: { increment: bandejas } } }),
        prisma.movimentacaoEstoque.create({
          data: {
            produtoId: item.produtoId,
            caixaId: venda.caixaId || null,
            tipo: 'ENTRADA',
            quantidade: bandejas,
            motivo: `Reabertura venda #${id}`,
          },
        }),
      ];
    }),
    prisma.venda.update({
      where: { id },
      data: { status: 'ORCAMENTO', formaPagamento: null, valorDinheiro: null, confirmadaEm: null },
    }),
  ];

  if (venda.contaReceber) {
    operacoes.push(prisma.contaReceber.delete({ where: { id: venda.contaReceber.id } }));
  }

  await prisma.$transaction(operacoes);

  return prisma.venda.findUnique({ where: { id }, include: INCLUDE_PADRAO });
}

module.exports = { INCLUDE_PADRAO, calcularTotal, processarCheckout, confirmarVenda, reabrirVenda };
