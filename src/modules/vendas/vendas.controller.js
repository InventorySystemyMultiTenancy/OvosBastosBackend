const prisma = require('../../config/db');
const { encontrarOuCriarClientePorNome } = require('../clientes/clientes.service');
const { processarCheckout, confirmarVenda } = require('./vendas.service');
const mpService = require('../mercadopago/mercadopago.service');

const INCLUDE_PADRAO = {
  cliente: true,
  vendedor: { select: { id: true, nome: true } },
  caixa: { select: { id: true, nome: true, unidade: true, ativo: true } },
  itens: { include: { produto: true } },
  pagamentoPointMP: true,
};

async function listar(req, res, next) {
  try {
    const { status, de, ate, caixaId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (caixaId) where.caixaId = Number(caixaId);
    if (de || ate) {
      where.confirmadaEm = {};
      if (de) where.confirmadaEm.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        where.confirmadaEm.lte = fim;
      }
    }

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

// Login travado a uma unidade (Usuario.unidade) só pode vender por um caixa daquela
// unidade — mesmo que o corpo da requisição peça outro, isso é barrado aqui (não só
// escondido no frontend). Uma unidade pode ter mais de um caixa físico.
async function caixaPermitida(req, caixaId) {
  if (!req.usuario?.unidade) return true;
  const caixa = await prisma.caixa.findUnique({ where: { id: Number(caixaId) }, select: { unidade: true } });
  return Boolean(caixa) && caixa.unidade === req.usuario.unidade;
}

async function criar(req, res, next) {
  try {
    const { clienteId, itens, desconto, caixaId } = req.body;
    if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
      return res.status(400).json({ error: 'clienteId e ao menos um item são obrigatórios' });
    }
    if (!(await caixaPermitida(req, caixaId))) {
      return res.status(400).json({ error: 'Este login só pode vender pela unidade designada' });
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
        caixaId: caixaId ? Number(caixaId) : null,
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
    const { nomeCliente, itens, formaPagamento, vencimento, desconto, caixaId, valorDinheiro } = req.body;

    if (!nomeCliente || !nomeCliente.trim()) {
      return res.status(400).json({ error: 'Informe o nome do cliente' });
    }
    if (!(await caixaPermitida(req, caixaId))) {
      return res.status(400).json({ error: 'Este login só pode vender pela unidade designada' });
    }

    const cliente = await encontrarOuCriarClientePorNome(nomeCliente);
    const venda = await processarCheckout({
      clienteId: cliente.id,
      vendedorId: req.usuario.id,
      caixaId,
      itens,
      formaPagamento,
      vencimento,
      desconto: Number(desconto) || 0,
      valorDinheiro,
    });

    res.status(201).json(venda);
  } catch (err) {
    next(err);
  }
}

async function confirmar(req, res, next) {
  try {
    const venda = await confirmarVenda(req.params.id, req.body);
    res.json(venda);
  } catch (err) {
    next(err);
  }
}

async function pagarMaquininha(req, res, next) {
  try {
    const pagamento = await mpService.enviarCobranca(req.params.id);
    res.status(201).json(pagamento);
  } catch (err) {
    next(err);
  }
}

async function cancelarPagamentoMaquininha(req, res, next) {
  try {
    const pagamento = await mpService.cancelarCobranca(req.params.id);
    res.json(pagamento);
  } catch (err) {
    next(err);
  }
}

async function statusPagamentoMaquininha(req, res, next) {
  try {
    const pagamento = await mpService.sincronizarStatus(req.params.id);
    res.json(pagamento);
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
      valorDinheiro: venda.valorDinheiro,
      status: venda.status,
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listar,
  obter,
  criar,
  checkout,
  confirmar,
  cancelar,
  comprovante,
  pagarMaquininha,
  cancelarPagamentoMaquininha,
  statusPagamentoMaquininha,
};
