const prisma = require('../../config/db');
const cloudinary = require('../../config/cloudinary');
const { registrarAlteracoes } = require('../../utils/historicoAlteracao');

async function listar(req, res, next) {
  try {
    const [produtos, estoques] = await Promise.all([
      prisma.produto.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        include: { niveisVenda: { where: { ativo: true }, orderBy: { quantidadeGrao: 'asc' } } },
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
    const { nome, tipo, estoqueMinimo, quantidade } = req.body;
    if (!nome) {
      return res.status(400).json({ error: 'Nome é obrigatório' });
    }

    const produto = await prisma.produto.create({
      data: {
        nome,
        tipo,
        estoqueMinimo: estoqueMinimo || 0,
        quantidade: quantidade || 0,
      },
    });
    res.status(201).json(produto);
  } catch (err) {
    next(err);
  }
}

// precoCusto já vem por grão-base (o frontend converte a partir do nível de referência antes
// de enviar — ver ProdutosTab.jsx) — aqui só grava o valor recebido.
async function atualizar(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { nome, tipo, precoCusto, estoqueMinimo } = req.body;

    const antes = await prisma.produto.findUnique({ where: { id } });
    if (!antes) return res.status(404).json({ error: 'Produto não encontrado' });

    const produto = await prisma.$transaction(async (tx) => {
      const atualizado = await tx.produto.update({
        where: { id },
        data: { nome, tipo, precoCusto, estoqueMinimo },
      });
      await registrarAlteracoes(tx, {
        produtoId: id,
        entidade: 'Produto',
        entidadeId: id,
        usuarioId: req.usuario?.id,
        alteracoes: [
          { campo: 'nome', valorAntigo: antes.nome, valorNovo: atualizado.nome },
          { campo: 'tipo', valorAntigo: antes.tipo, valorNovo: atualizado.tipo },
          { campo: 'precoCusto', valorAntigo: antes.precoCusto, valorNovo: atualizado.precoCusto },
          { campo: 'estoqueMinimo', valorAntigo: antes.estoqueMinimo, valorNovo: atualizado.estoqueMinimo },
        ],
      });
      return atualizado;
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

async function remover(req, res, next) {
  try {
    const id = Number(req.params.id);
    const antes = await prisma.produto.findUnique({ where: { id } });
    if (!antes) return res.status(404).json({ error: 'Produto não encontrado' });

    await prisma.$transaction(async (tx) => {
      await tx.produto.update({ where: { id }, data: { ativo: false } });
      await registrarAlteracoes(tx, {
        produtoId: id,
        entidade: 'Produto',
        entidadeId: id,
        usuarioId: req.usuario?.id,
        alteracoes: [{ campo: 'ativo', valorAntigo: antes.ativo, valorNovo: false }],
      });
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Histórico de auditoria do produto (nome/preços) — inclui alterações feitas em qualquer
// nível de venda dele, não só no Produto em si (ver HistoricoAlteracao.produtoId).
async function historico(req, res, next) {
  try {
    const produtoId = Number(req.params.id);
    const registros = await prisma.historicoAlteracao.findMany({
      where: { produtoId },
      include: { usuario: { select: { id: true, nome: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    // Nível de venda pode já ter sido desativado/renomeado desde então — busca o nome atual só
    // pra dar contexto na lista ("preço do nível X mudou"), não representa o nome na época.
    const nivelIds = [...new Set(registros.filter((r) => r.entidade === 'NivelVendaProduto').map((r) => r.entidadeId))];
    const niveis = nivelIds.length
      ? await prisma.nivelVendaProduto.findMany({ where: { id: { in: nivelIds } }, select: { id: true, nome: true } })
      : [];
    const mapaNiveis = new Map(niveis.map((n) => [n.id, n.nome]));

    res.json(
      registros.map((r) => ({
        ...r,
        nivelNome: r.entidade === 'NivelVendaProduto' ? mapaNiveis.get(r.entidadeId) || null : null,
      }))
    );
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, obter, criar, atualizar, enviarImagem, remover, historico };
