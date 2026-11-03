const prisma = require('../../config/db');
const { mapaAcrescimos, precoComAcrescimo } = require('../../utils/acrescimoCaixa');

// Nunca inclui mpAccessTokenEnc: é o access token criptografado da conta Mercado Pago
// daquele caixa e não deve sair do backend.
const SELECT_SEGURO = {
  id: true,
  nome: true,
  unidade: true,
  ativo: true,
  createdAt: true,
  mpUserId: true,
  mpNicknameConta: true,
  mpDeviceId: true,
};

function comMpConfigurado(caixa) {
  return { ...caixa, mpConfigurado: Boolean(caixa.mpDeviceId) };
}

async function listar(req, res, next) {
  try {
    const where = req.query.ativo !== undefined ? { ativo: req.query.ativo === 'true' } : {};
    const caixas = await prisma.caixa.findMany({ where, orderBy: { id: 'asc' }, select: SELECT_SEGURO });
    res.json(caixas.map(comMpConfigurado));
  } catch (err) {
    next(err);
  }
}

async function criar(req, res, next) {
  try {
    const { nome, unidade } = req.body;
    if (!nome || !nome.trim() || !unidade || !unidade.trim()) {
      return res.status(400).json({ error: 'nome e unidade são obrigatórios' });
    }
    const caixa = await prisma.caixa.create({
      data: { nome: nome.trim(), unidade: unidade.trim() },
      select: SELECT_SEGURO,
    });
    res.status(201).json(comMpConfigurado(caixa));
  } catch (err) {
    next(err);
  }
}

async function atualizar(req, res, next) {
  try {
    const { nome, unidade, ativo } = req.body;
    const data = {};
    if (nome !== undefined) data.nome = nome.trim();
    if (unidade !== undefined) data.unidade = unidade.trim();
    if (ativo !== undefined) data.ativo = Boolean(ativo);

    const caixa = await prisma.caixa.update({ where: { id: Number(req.params.id) }, data, select: SELECT_SEGURO });
    res.json(comMpConfigurado(caixa));
  } catch (err) {
    next(err);
  }
}

async function estoquePorCaixa(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    const caixa = await prisma.caixa.findUnique({ where: { id: caixaId } });
    if (!caixa || !caixa.ativo) return res.status(404).json({ error: 'Caixa não encontrado' });

    const [produtos, estoques, acrescimos] = await Promise.all([
      prisma.produto.findMany({
        where: { ativo: true },
        orderBy: { nome: 'asc' },
        include: { niveisVenda: { where: { ativo: true }, orderBy: { quantidadeGrao: 'asc' } } },
      }),
      prisma.estoqueCaixa.findMany({ where: { caixaId } }),
      mapaAcrescimos(caixaId),
    ]);
    const mapaQtd = new Map(estoques.map((e) => [e.produtoId, e.quantidade]));
    // O preço de cada nível já sai com o valor extra deste caixa somado — é o preço que o
    // PDV mostra e cobra. Só admin recebe o detalhe (preço normal + extra) pra poder editar;
    // pro vendedor é só o preço final, sem indicação de que tem um valor adicional.
    const ehAdmin = req.usuario?.perfil === 'ADMIN';
    res.json(
      produtos.map((p) => ({
        ...p,
        quantidade: mapaQtd.get(p.id) || 0,
        niveisVenda: p.niveisVenda.map((n) => {
          const acrescimo = acrescimos.get(n.id) || 0;
          const nivel = { ...n, preco: precoComAcrescimo(n.preco, acrescimo) };
          if (ehAdmin) Object.assign(nivel, { precoNormal: Number(n.preco), acrescimoCaixa: acrescimo });
          return nivel;
        }),
      }))
    );
  } catch (err) {
    next(err);
  }
}

// Define (ou remove, com valor 0/vazio) o valor extra que este caixa cobra num nível de venda.
// Fica fixo até ser editado ou removido aqui — não mexe no preço do nível nem no estoque.
async function definirAcrescimo(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    const nivelVendaId = Number(req.params.nivelVendaId);
    const valor = req.body.valor === '' || req.body.valor === null || req.body.valor === undefined ? 0 : Number(req.body.valor);
    if (Number.isNaN(valor) || valor < 0) {
      return res.status(400).json({ error: 'Valor extra deve ser zero ou maior' });
    }

    const [caixa, nivel] = await Promise.all([
      prisma.caixa.findUnique({ where: { id: caixaId } }),
      prisma.nivelVendaProduto.findUnique({ where: { id: nivelVendaId } }),
    ]);
    if (!caixa) return res.status(404).json({ error: 'Caixa não encontrado' });
    if (!nivel) return res.status(404).json({ error: 'Item do catálogo não encontrado' });

    const chave = { caixaId_nivelVendaId: { caixaId, nivelVendaId } };
    if (valor === 0) {
      await prisma.acrescimoCaixaNivel.deleteMany({ where: { caixaId, nivelVendaId } });
    } else {
      await prisma.acrescimoCaixaNivel.upsert({
        where: chave,
        create: { caixaId, nivelVendaId, valor },
        update: { valor },
      });
    }
    res.json({ caixaId, nivelVendaId, acrescimoCaixa: valor, precoNormal: Number(nivel.preco), preco: precoComAcrescimo(nivel.preco, valor) });
  } catch (err) {
    next(err);
  }
}

module.exports = { listar, criar, atualizar, estoquePorCaixa, definirAcrescimo };
