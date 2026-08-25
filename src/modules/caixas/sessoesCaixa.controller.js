const prisma = require('../../config/db');
const { sessaoAbertaDoCaixa } = require('./sessoesCaixa.service');

const USUARIO_SELECT = { id: true, nome: true };

const INCLUDE_SESSAO = {
  usuarioAbertura: { select: USUARIO_SELECT },
  usuarioFechamento: { select: USUARIO_SELECT },
};

// Login travado a um caixa (Usuario.caixaId) só pode abrir/fechar/consultar aquela unidade —
// mesmo padrão usado em vendas.controller.caixaPermitida.
function caixaPermitida(req, caixaId) {
  if (!req.usuario?.caixaId) return true;
  return Number(caixaId) === req.usuario.caixaId;
}

function arredondar(valor) {
  return Math.round(Number(valor) * 100) / 100;
}

function validarValorContado(valor, campo) {
  const numero = Number(valor);
  if (valor === undefined || valor === null || valor === '' || Number.isNaN(numero) || numero < 0) {
    throw Object.assign(new Error(`${campo} é obrigatório e deve ser um valor válido (>= 0)`), { status: 400 });
  }
  return arredondar(numero);
}

async function sessaoAtual(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    if (!caixaPermitida(req, caixaId)) {
      return res.status(403).json({ error: 'Este login só pode acessar a unidade designada' });
    }

    const [sessaoAberta, ultimoFechamento] = await Promise.all([
      prisma.sessaoCaixa.findFirst({ where: { caixaId, status: 'ABERTA' }, include: INCLUDE_SESSAO }),
      prisma.sessaoCaixa.findFirst({
        where: { caixaId, status: 'FECHADA' },
        orderBy: { fechadaEm: 'desc' },
        include: INCLUDE_SESSAO,
      }),
    ]);

    res.json({ sessaoAberta, ultimoFechamento });
  } catch (err) {
    next(err);
  }
}

async function abrir(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    if (!caixaPermitida(req, caixaId)) {
      return res.status(403).json({ error: 'Este login só pode abrir a unidade designada' });
    }

    const caixa = await prisma.caixa.findUnique({ where: { id: caixaId } });
    if (!caixa || !caixa.ativo) {
      return res.status(404).json({ error: 'Caixa não encontrado' });
    }

    const jaAberta = await sessaoAbertaDoCaixa(caixaId);
    if (jaAberta) {
      return res.status(409).json({ error: 'Este caixa já está aberto — feche a sessão atual antes de abrir outra' });
    }

    const valorAbertura = validarValorContado(req.body.valorAbertura, 'valorAbertura');

    const ultimoFechamento = await prisma.sessaoCaixa.findFirst({
      where: { caixaId, status: 'FECHADA' },
      orderBy: { fechadaEm: 'desc' },
    });

    const valorEsperadoAbertura = ultimoFechamento ? Number(ultimoFechamento.valorFechamento) : null;
    const divergenciaAbertura = valorEsperadoAbertura !== null ? arredondar(valorAbertura - valorEsperadoAbertura) : null;

    const sessao = await prisma.sessaoCaixa.create({
      data: {
        caixaId,
        usuarioAberturaId: req.usuario.id,
        valorAbertura,
        valorEsperadoAbertura,
        divergenciaAbertura,
      },
      include: INCLUDE_SESSAO,
    });

    res.status(201).json({ ...sessao, divergenciaDetectada: Boolean(divergenciaAbertura) });
  } catch (err) {
    next(err);
  }
}

async function fechar(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    if (!caixaPermitida(req, caixaId)) {
      return res.status(403).json({ error: 'Este login só pode fechar a unidade designada' });
    }

    const sessao = await sessaoAbertaDoCaixa(caixaId);
    if (!sessao) {
      return res.status(404).json({ error: 'Nenhum caixa aberto para esta unidade' });
    }

    const valorFechamento = validarValorContado(req.body.valorFechamento, 'valorFechamento');
    const observacao = typeof req.body.observacao === 'string' ? req.body.observacao.trim() || null : null;

    const sessaoFechada = await prisma.sessaoCaixa.update({
      where: { id: sessao.id },
      data: {
        status: 'FECHADA',
        usuarioFechamentoId: req.usuario.id,
        valorFechamento,
        observacaoFechamento: observacao,
        fechadaEm: new Date(),
      },
      include: INCLUDE_SESSAO,
    });

    res.json(sessaoFechada);
  } catch (err) {
    next(err);
  }
}

async function listarPorCaixa(req, res, next) {
  try {
    const caixaId = Number(req.params.id);
    const { de, ate } = req.query;
    const where = { caixaId };
    if (de || ate) {
      where.abertaEm = {};
      if (de) where.abertaEm.gte = new Date(de);
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        where.abertaEm.lte = fim;
      }
    }

    const sessoes = await prisma.sessaoCaixa.findMany({ where, include: INCLUDE_SESSAO, orderBy: { abertaEm: 'desc' } });
    res.json(sessoes);
  } catch (err) {
    next(err);
  }
}

module.exports = { sessaoAtual, abrir, fechar, listarPorCaixa };
