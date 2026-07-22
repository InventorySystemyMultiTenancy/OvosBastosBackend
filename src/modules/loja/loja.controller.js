const prisma = require('../../config/db');
const { encontrarOuCriarClientePorNome } = require('../clientes/clientes.service');
const { processarCheckout } = require('../vendas/vendas.service');

async function listarCatalogo(req, res, next) {
  try {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      select: {
        id: true,
        nome: true,
        tipo: true,
        unidade: true,
        precoVenda: true,
        quantidade: true,
        estoqueMinimo: true,
      },
      orderBy: { nome: 'asc' },
    });
    res.json(produtos);
  } catch (err) {
    next(err);
  }
}

async function criarPedido(req, res, next) {
  try {
    const { nomeCliente, itens, formaPagamento } = req.body;

    if (!nomeCliente || !nomeCliente.trim()) {
      return res.status(400).json({ error: 'Informe o nome para finalizar o pedido' });
    }
    if (formaPagamento === 'FIADO') {
      return res.status(400).json({ error: 'Forma de pagamento indisponível na loja online' });
    }

    const cliente = await encontrarOuCriarClientePorNome(nomeCliente);
    const venda = await processarCheckout({
      clienteId: cliente.id,
      vendedorId: null,
      itens,
      formaPagamento,
      origemMotivo: 'Pedido loja',
    });

    res.status(201).json(venda);
  } catch (err) {
    next(err);
  }
}

module.exports = { listarCatalogo, criarPedido };
