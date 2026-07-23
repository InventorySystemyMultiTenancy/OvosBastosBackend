const fs = require('fs');
const path = require('path');
const prisma = require('../../config/db');
const { PASTA_UPLOADS } = require('../../config/upload');

async function listar(req, res, next) {
  try {
    const produtos = await prisma.produto.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
    });
    res.json(produtos);
  } catch (err) {
    next(err);
  }
}

async function obter(req, res, next) {
  try {
    const produto = await prisma.produto.findUnique({
      where: { id: Number(req.params.id) },
      include: { lotes: { orderBy: { validade: 'asc' } } },
    });
    if (!produto) return res.status(404).json({ error: 'Produto não encontrado' });
    res.json(produto);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, tipo, unidade, precoVenda, precoCusto, estoqueMinimo, quantidade } = req.body;
    if (!nome || precoVenda === undefined) {
      return res.status(400).json({ error: 'Nome e preço de venda são obrigatórios' });
    }

    const produto = await prisma.produto.create({
      data: {
        nome,
        tipo,
        unidade: unidade || 'dúzia',
        precoVenda,
        precoCusto,
        estoqueMinimo: estoqueMinimo || 0,
        quantidade: quantidade || 0,
      },
    });
    res.status(201).json(produto);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { nome, tipo, unidade, precoVenda, precoCusto, estoqueMinimo } = req.body;
    const produto = await prisma.produto.update({
      where: { id: Number(req.params.id) },
      data: { nome, tipo, unidade, precoVenda, precoCusto, estoqueMinimo },
    });
    res.json(produto);
  } catch (err) {
    next(err);
  }
}

async function enviarImagem(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de imagem' });

    const id = Number(req.params.id);
    const produtoAtual = await prisma.produto.findUnique({ where: { id } });
    if (!produtoAtual) return res.status(404).json({ error: 'Produto não encontrado' });

    if (produtoAtual.imagemUrl) {
      const arquivoAntigo = path.join(PASTA_UPLOADS, path.basename(produtoAtual.imagemUrl));
      fs.unlink(arquivoAntigo, () => {});
    }

    const imagemUrl = `/uploads/produtos/${req.file.filename}`;
    const produto = await prisma.produto.update({ where: { id }, data: { imagemUrl } });
    res.json(produto);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    await prisma.produto.update({ where: { id: Number(req.params.id) }, data: { ativo: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, atualizar, enviarImagem, remover };
