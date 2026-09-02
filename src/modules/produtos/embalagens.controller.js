const prisma = require('../../config/db');
const cloudinary = require('../../config/cloudinary');

// "Caixa" comercial de um produto (ex: caixa com 30 bandejas) — não tem estoque próprio,
// só existe pra oferecer o produto num tamanho de pacote com preço fechado; o desconto de
// estoque na venda sai direto do Produto (ver vendas.service.js).

async function listarPorProduto(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const embalagens = await prisma.embalagemProduto.findMany({
      where: { produtoId, ativo: true },
      orderBy: { quantidadeBandejas: 'asc' },
    });
    res.json(embalagens);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const { nome, quantidadeBandejas, preco } = req.body;
    if (!nome || !nome.trim() || !quantidadeBandejas || Number(quantidadeBandejas) <= 0 || preco === undefined || Number(preco) < 0) {
      return res.status(400).json({ error: 'Nome, quantidade de bandejas (> 0) e preço (>= 0) são obrigatórios' });
    }

    const produto = await prisma.produto.findUnique({ where: { id: produtoId } });
    if (!produto || !produto.ativo) return res.status(404).json({ error: 'Produto não encontrado' });

    const embalagem = await prisma.embalagemProduto.create({
      data: {
        produtoId,
        nome: nome.trim(),
        quantidadeBandejas: Number(quantidadeBandejas),
        preco: Number(preco),
      },
    });
    res.status(201).json(embalagem);
  } catch (err) {
    next(err);
  }
}

async function enviarImagem(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de imagem' });

    const embalagemId = Number(req.params.embalagemId);
    const embalagem = await prisma.embalagemProduto.findUnique({ where: { id: embalagemId } });
    if (!embalagem || embalagem.produtoId !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Caixa não encontrada' });
    }

    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ovosbastos/embalagens', public_id: `embalagem-${embalagemId}`, overwrite: true, resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    const atualizada = await prisma.embalagemProduto.update({ where: { id: embalagemId }, data: { imagemUrl: resultado.secure_url } });
    res.json(atualizada);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const embalagem = await prisma.embalagemProduto.findUnique({ where: { id: Number(req.params.embalagemId) } });
    if (!embalagem || embalagem.produtoId !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Caixa não encontrada' });
    }
    await prisma.embalagemProduto.update({ where: { id: embalagem.id }, data: { ativo: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listarPorProduto, criar, enviarImagem, remover };
