const prisma = require('../../config/db');
const { encontrarOuCriarClientePorNome } = require('../clientes/clientes.service');
const { processarCheckout } = require('./vendas.service');

const INCLUDE_PADRAO = {
  cliente: true,
  vendedor: { select: { id: true, nome: true } },
  itens: { include: { produto: true } },
};

async function listar(req, res, next) {
  try {
    const where = req.query.status ? { status: req.query.status } : {};
    const vendas = await prisma.venda.findMany({
      where,
      include: INCLUDE_PADRAO,
      orderBy: { createdAt: 'desc' },
    });
    res.json(vendas);
  } catch (err) {
    next(err);
  }
}

async function obter(req, res, next) {
  try {
    const venda = await prisma.venda.findUnique({
      where: { id: Number(req.params.id) },
      include: INCLUDE_PADRAO,
    });
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    res.json(venda);
  } catch (err) {
    next(err);
  }
}

function calcularTotal(itensComPreco, desconto) {
  const bruto = itensComPreco.reduce((soma, i) => soma + i.quantidade * Number(i.precoUnit), 0);
  return Math.max(bruto - Number(desconto || 0), 0);
}

async function criar(req, res, next) {
  try {
    const { clienteId, itens, desconto } = req.body;
    if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'clienteId e ao menos um item são obrigatórios' });
    }

    const produtos = await prisma.produto.findMany({
      where: { id: { in: itens.map((i) => Number(i.produtoId)) } },
    });
    const itensComPreco = itens.map((i) => {
      const produto = produtos.find((p) => p.id === Number(i.produtoId));
      if (!produto) throw Object.assign(new Error(`Produto ${i.produtoId} não encontrado`), { status: 400 });
      return { produtoId: produto.id, quantidade: Number(i.quantidade), precoUnit: produto.precoVenda };
    });

    const total = calcularTotal(itensComPreco, desconto);

    const venda = await prisma.venda.create({
      data: {
        clienteId: Number(clienteId),
        vendedorId: req.usuario.id,
        desconto: desconto || 0,
        total,
        itens: { create: itensComPreco },
      },
      include: INCLUDE_PADRAO,
    });

    res.status(201).json(venda);
  } catch (err) {
    next(err);
  }
}

async function checkout(req, res, next) {
  try {
    const { nomeCliente, itens, formaPagamento, vencimento } = req.body;

    if (!nomeCliente || !nomeCliente.trim()) {
      return res.status(400).json({ error: 'Informe o nome do cliente' });
    }

    const cliente = await encontrarOuCriarClientePorNome(nomeCliente);
    const venda = await processarCheckout({
      clienteId: cliente.id,
      vendedorId: req.usuario.id,
      itens,
      formaPagamento,
      vencimento,
    });

    res.status(201).json(venda);
  } catch (err) {
    next(err);
  }
}

async function confirmar(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { formaPagamento, vencimento } = req.body;
    if (!formaPagamento) return res.status(400).json({ error: 'formaPagamento é obrigatória' });

    const venda = await prisma.venda.findUnique({ where: { id }, include: { itens: true, cliente: true } });
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (venda.status !== 'ORCAMENTO') {
      return res.status(400).json({ error: 'Somente orçamentos podem ser confirmados' });
    }

    for (const item of venda.itens) {
      const produto = await prisma.produto.findUnique({ where: { id: item.produtoId } });
      if (produto.quantidade < item.quantidade) {
        return res.status(400).json({ error: `Estoque insuficiente para o produto "${produto.nome}"` });
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
        return res.status(400).json({ error: 'Limite de crédito do cliente excedido' });
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
            valor: venda.total,
            vencimento: vencimento ? new Date(vencimento) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          },
        })
      );
    }

    await prisma.$transaction(operacoes);

    const vendaAtualizada = await prisma.venda.findUnique({ where: { id }, include: INCLUDE_PADRAO });
    res.json(vendaAtualizada);
  } catch (err) {
    next(err);
  }
}

async function cancelar(req, res, next) {
  try {
    const id = Number(req.params.id);
    const venda = await prisma.venda.findUnique({ where: { id } });
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });
    if (venda.status !== 'ORCAMENTO') {
      return res.status(400).json({ error: 'Somente orçamentos podem ser cancelados' });
    }

    const vendaCancelada = await prisma.venda.update({ where: { id }, data: { status: 'CANCELADA' } });
    res.json(vendaCancelada);
  } catch (err) {
    next(err);
  }
}

async function comprovante(req, res, next) {
  try {
    const venda = await prisma.venda.findUnique({ where: { id: Number(req.params.id) }, include: INCLUDE_PADRAO });
    if (!venda) return res.status(404).json({ error: 'Venda não encontrada' });

    res.json({
      numero: venda.id,
      data: venda.confirmadaEm || venda.createdAt,
      cliente: venda.cliente.nome,
      vendedor: venda.vendedor?.nome || 'Loja Online',
      itens: venda.itens.map((i) => ({
        produto: i.produto.nome,
        quantidade: i.quantidade,
        precoUnit: i.precoUnit,
        subtotal: Number(i.precoUnit) * i.quantidade,
      })),
      desconto: venda.desconto,
      total: venda.total,
      formaPagamento: venda.formaPagamento,
      status: venda.status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, checkout, confirmar, cancelar, comprovante };
