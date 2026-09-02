const prisma = require('../../config/db');
const cloudinary = require('../../config/cloudinary');

async function listar(req, res, next) {
  try {
    const [produtos, estoques] = await Promise.all([
      prisma.produto.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        include: { embalagens: { where: { ativo: true }, orderBy: { quantidadeBandejas: 'asc' } } },
      }),
      prisma.estoqueCaixa.findMany({ where: { caixa: { ativo: true } } }),
    ]);
    const mapaDistribuido = {};
    estoques.forEach((e) => {
      mapaDistribuido[e.produtoId] = (mapaDistribuido[e.produtoId] || 0) + e.quantidade;
    });
    res.json(
      produtos.map((p) => ({
        ...p,
        quantidadeDistribuida: mapaDistribuido[p.id] || 0,
        estoqueTotal: p.quantidade + (mapaDistribuido[p.id] || 0),
      }))
    );
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

    // public_id fixo por produto: reenviar uma imagem para o mesmo produto
    // sobrescreve o arquivo anterior no Cloudinary em vez de acumular lixo.
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ovosbastos/produtos', public_id: `produto-${id}`, overwrite: true, resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    const produto = await prisma.produto.update({ where: { id }, data: { imagemUrl: resultado.secure_url } });
    res.json(produto);
  } catch (err) {
    next(err);
  }
}

// Muda o grão em que o estoque deste produto é contado (Produto.unidadesPorPacote). Reconverte
// tudo que compartilha esse mesmo estoque — pool central, estoque por unidade e o tamanho das
// caixas já cadastradas — pela razão entre o fator novo e o antigo, pra continuar
// representando a mesma quantidade física, só que num grão diferente (ex: de "dúzias" pra
// "ovos"). É assim que se ativa a venda por unidade avulsa (ver vendas.service.js).
async function ativarVendaPorUnidade(req, res, next) {
  try {
    const id = Number(req.params.id);
    const novoFator = Number(req.body.unidadesPorPacote);
    if (!novoFator || novoFator < 1 || !Number.isInteger(novoFator)) {
      return res.status(400).json({ error: 'unidadesPorPacote deve ser um número inteiro >= 1' });
    }

    const produto = await prisma.produto.findUnique({ where: { id } });
    if (!produto || !produto.ativo) return res.status(404).json({ error: 'Produto não encontrado' });

    const fatorAtual = produto.unidadesPorPacote || 1;
    if (novoFator === fatorAtual) {
      return res.json(produto);
    }

    const razao = novoFator / fatorAtual;

    const [estoquesCaixa, embalagens] = await Promise.all([
      prisma.estoqueCaixa.findMany({ where: { produtoId: id } }),
      prisma.embalagemProduto.findMany({ where: { produtoId: id } }),
    ]);

    await prisma.$transaction([
      prisma.produto.update({
        where: { id },
        data: {
          unidadesPorPacote: novoFator,
          quantidade: Math.round(produto.quantidade * razao),
          estoqueMinimo: Math.round(produto.estoqueMinimo * razao),
        },
      }),
      ...estoquesCaixa.map((e) =>
        prisma.estoqueCaixa.update({ where: { id: e.id }, data: { quantidade: Math.round(e.quantidade * razao) } })
      ),
      ...embalagens.map((emb) =>
        prisma.embalagemProduto.update({
          where: { id: emb.id },
          data: { quantidadeBandejas: Math.round(emb.quantidadeBandejas * razao) },
        })
      ),
    ]);

    res.json(await prisma.produto.findUnique({ where: { id } }));
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

module.exports = { listar, obter, criar, atualizar, enviarImagem, ativarVendaPorUnidade, remover };
