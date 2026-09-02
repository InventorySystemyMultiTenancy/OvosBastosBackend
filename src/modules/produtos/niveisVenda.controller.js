const prisma = require('../../config/db');
const cloudinary = require('../../config/cloudinary');

// Um nível de venda é um jeito vendável de embalar o mesmo produto (Unidade/Dúzia/Bandeja/
// Caixa) — não tem estoque próprio, todos descontam do mesmo estoque em grão-base do Produto
// na venda (ver vendas.service.js). Cada produto tem exatamente 1 nível ehBase=true, cujo
// preço é digitado à mão e serve de referência: os demais níveis com precoManual=false têm o
// preço recalculado automaticamente toda vez que o preço base muda.

function arredondarMoeda(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

// Recalcula (e grava) o preço de todo nível ativo, não-base e não travado manualmente
// (precoManual=false) do produto, proporcional ao nível base informado.
async function recalcularDerivados(tx, produtoId, base, { excetoId } = {}) {
  const niveis = await tx.nivelVendaProduto.findMany({
    where: { produtoId, ativo: true, precoManual: false, id: { not: excetoId || base.id } },
  });
  await Promise.all(
    niveis.map((n) =>
      tx.nivelVendaProduto.update({
        where: { id: n.id },
        data: { preco: arredondarMoeda((Number(base.preco) / base.quantidadeGrao) * n.quantidadeGrao) },
      })
    )
  );
}

async function listarPorProduto(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const niveis = await prisma.nivelVendaProduto.findMany({
      where: { produtoId, ativo: true },
      orderBy: { quantidadeGrao: 'asc' },
    });
    res.json(niveis);
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const { nome, quantidadeGrao, preco } = req.body;
    if (!nome || !nome.trim() || !quantidadeGrao || Number(quantidadeGrao) <= 0) {
      return res.status(400).json({ error: 'Nome e quantidade em grão-base (> 0) são obrigatórios' });
    }

    const produto = await prisma.produto.findUnique({ where: { id: produtoId } });
    if (!produto || !produto.ativo) return res.status(404).json({ error: 'Produto não encontrado' });

    const baseAtual = await prisma.nivelVendaProduto.findFirst({ where: { produtoId, ehBase: true, ativo: true } });

    let precoFinal;
    let precoManual;
    if (preco !== undefined && preco !== null && preco !== '') {
      precoFinal = Number(preco);
      precoManual = true;
    } else if (baseAtual) {
      precoFinal = arredondarMoeda((Number(baseAtual.preco) / baseAtual.quantidadeGrao) * Number(quantidadeGrao));
      precoManual = false;
    } else {
      return res.status(400).json({ error: 'Preço é obrigatório para o primeiro nível deste produto' });
    }

    const nivel = await prisma.nivelVendaProduto.create({
      data: {
        produtoId,
        nome: nome.trim(),
        quantidadeGrao: Number(quantidadeGrao),
        preco: precoFinal,
        ehBase: !baseAtual,
        precoManual: !baseAtual ? true : precoManual,
      },
    });
    res.status(201).json(nivel);
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const nivelId = Number(req.params.nivelId);
    const nivel = await prisma.nivelVendaProduto.findUnique({ where: { id: nivelId } });
    if (!nivel || nivel.produtoId !== produtoId) {
      return res.status(404).json({ error: 'Nível não encontrado' });
    }

    const { nome, quantidadeGrao, preco } = req.body;
    const data = {};
    if (nome !== undefined) data.nome = nome.trim();
    if (quantidadeGrao !== undefined) data.quantidadeGrao = Number(quantidadeGrao);
    if (preco !== undefined) {
      data.preco = Number(preco);
      if (!nivel.ehBase) data.precoManual = true;
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      const salvo = await tx.nivelVendaProduto.update({ where: { id: nivelId }, data });
      // Preço ou o próprio tamanho do nível base mudou — a proporção usada pra derivar os
      // outros níveis mudou junto, então todos precisam ser recalculados de novo.
      if (salvo.ehBase && (preco !== undefined || quantidadeGrao !== undefined)) {
        await recalcularDerivados(tx, produtoId, salvo);
      }
      return salvo;
    });

    res.json(atualizado);
  } catch (err) {
    next(err);
  }
}

// Marca este nível como a referência de preço do produto (ehBase) — o preço atual dele passa
// a ser a base, e todo nível não travado manualmente é recalculado proporcionalmente a partir
// daqui. O antigo nível base perde a marcação mas mantém o preço que tinha.
async function definirBase(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const nivelId = Number(req.params.nivelId);
    const nivel = await prisma.nivelVendaProduto.findUnique({ where: { id: nivelId } });
    if (!nivel || nivel.produtoId !== produtoId || !nivel.ativo) {
      return res.status(404).json({ error: 'Nível não encontrado' });
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await tx.nivelVendaProduto.updateMany({
        where: { produtoId, ehBase: true, id: { not: nivelId } },
        data: { ehBase: false },
      });
      const novaBase = await tx.nivelVendaProduto.update({
        where: { id: nivelId },
        data: { ehBase: true, precoManual: true },
      });
      await recalcularDerivados(tx, produtoId, novaBase);
      return novaBase;
    });

    res.json(atualizado);
  } catch (err) {
    next(err);
  }
}

// Destrava este nível do preço manual e recalcula 1x a partir do nível base atual.
async function recalcular(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const nivelId = Number(req.params.nivelId);
    const nivel = await prisma.nivelVendaProduto.findUnique({ where: { id: nivelId } });
    if (!nivel || nivel.produtoId !== produtoId) {
      return res.status(404).json({ error: 'Nível não encontrado' });
    }
    if (nivel.ehBase) {
      return res.status(400).json({ error: 'O nível base não pode ser recalculado — ele é a própria referência' });
    }

    const base = await prisma.nivelVendaProduto.findFirst({ where: { produtoId, ehBase: true, ativo: true } });
    if (!base) return res.status(400).json({ error: 'Este produto não tem um nível de referência definido' });

    const atualizado = await prisma.nivelVendaProduto.update({
      where: { id: nivelId },
      data: {
        precoManual: false,
        preco: arredondarMoeda((Number(base.preco) / base.quantidadeGrao) * nivel.quantidadeGrao),
      },
    });
    res.json(atualizado);
  } catch (err) {
    next(err);
  }
}

async function enviarImagem(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de imagem' });

    const nivelId = Number(req.params.nivelId);
    const nivel = await prisma.nivelVendaProduto.findUnique({ where: { id: nivelId } });
    if (!nivel || nivel.produtoId !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Nível não encontrado' });
    }

    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ovosbastos/niveis-venda', public_id: `nivel-${nivelId}`, overwrite: true, resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    const atualizado = await prisma.nivelVendaProduto.update({ where: { id: nivelId }, data: { imagemUrl: resultado.secure_url } });
    res.json(atualizado);
  } catch (err) {
    next(err);
  }
}

async function remover(req, res, next) {
  try {
    const nivel = await prisma.nivelVendaProduto.findUnique({ where: { id: Number(req.params.nivelId) } });
    if (!nivel || nivel.produtoId !== Number(req.params.id)) {
      return res.status(404).json({ error: 'Nível não encontrado' });
    }
    if (nivel.ehBase) {
      return res.status(400).json({ error: 'Defina outro nível como referência antes de remover este' });
    }
    await prisma.nivelVendaProduto.update({ where: { id: nivel.id }, data: { ativo: false } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { listarPorProduto, criar, atualizar, definirBase, recalcular, enviarImagem, remover };
