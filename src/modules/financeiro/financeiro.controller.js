const prisma = require('../../config/db');

async function listarContasReceber(req, res, next) {
  try {
    const where = req.query.pago !== undefined ? { pago: req.query.pago === 'true' } : {};
    if (req.query.caixaId) where.caixaId = Number(req.query.caixaId);
    const contas = await prisma.contaReceber.findMany({
      where,
      include: { cliente: true, caixa: true },
      orderBy: { vencimento: 'asc' },
    });
    res.json(contas);
  } catch (err) {
    next(err);
  }
}

async function criarContaReceber(req, res, next) {
  try {
    const { clienteId, valor, vencimento, caixaId } = req.body;
    if (!clienteId || !valor || !vencimento) {
      return res.status(400).json({ error: 'clienteId, valor e vencimento são obrigatórios' });
    }
    const conta = await prisma.contaReceber.create({
      data: {
        clienteId: Number(clienteId),
        valor,
        vencimento: new Date(vencimento),
        caixaId: caixaId ? Number(caixaId) : null,
      },
    });
    res.status(201).json(conta);
  } catch (err) {
    next(err);
  }
}

async function pagarContaReceber(req, res, next) {
  try {
    const conta = await prisma.contaReceber.update({
      where: { id: Number(req.params.id) },
      data: { pago: true, pagoEm: new Date() },
    });
    res.json(conta);
  } catch (err) {
    next(err);
  }
}

async function listarContasPagar(req, res, next) {
  try {
    const where = req.query.pago !== undefined ? { pago: req.query.pago === 'true' } : {};
    if (req.query.caixaId) where.caixaId = Number(req.query.caixaId);
    const contas = await prisma.contaPagar.findMany({ where, include: { caixa: true }, orderBy: { vencimento: 'asc' } });
    res.json(contas);
  } catch (err) {
    next(err);
  }
}

async function criarContaPagar(req, res, next) {
  try {
    const { descricao, fornecedor, valor, vencimento, caixaId } = req.body;
    if (!descricao || !valor || !vencimento) {
      return res.status(400).json({ error: 'descricao, valor e vencimento são obrigatórios' });
    }
    const conta = await prisma.contaPagar.create({
      data: { descricao, fornecedor, valor, vencimento: new Date(vencimento), caixaId: caixaId ? Number(caixaId) : null },
    });
    res.status(201).json(conta);
  } catch (err) {
    next(err);
  }
}

async function pagarContaPagar(req, res, next) {
  try {
    const conta = await prisma.contaPagar.update({
      where: { id: Number(req.params.id) },
      data: { pago: true, pagoEm: new Date() },
    });
    res.json(conta);
  } catch (err) {
    next(err);
  }
}

function chaveMes(data) {
  const d = new Date(data);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function fluxoCaixa(req, res, next) {
  try {
    const meses = Number(req.query.meses) || 6;
    const desde = new Date();
    desde.setMonth(desde.getMonth() - (meses - 1));
    desde.setDate(1);
    desde.setHours(0, 0, 0, 0);

    const [vendas, contasPagas] = await Promise.all([
      prisma.venda.findMany({
        where: { status: 'CONFIRMADA', confirmadaEm: { gte: desde } },
        select: { total: true, confirmadaEm: true },
      }),
      prisma.contaPagar.findMany({
        where: { pago: true, pagoEm: { gte: desde } },
        select: { valor: true, pagoEm: true },
      }),
    ]);

    const mapa = {};
    for (let i = 0; i < meses; i++) {
      const d = new Date(desde);
      d.setMonth(d.getMonth() + i);
      mapa[chaveMes(d)] = { mes: chaveMes(d), receitas: 0, despesas: 0 };
    }

    vendas.forEach((v) => {
      const chave = chaveMes(v.confirmadaEm);
      if (mapa[chave]) mapa[chave].receitas += Number(v.total);
    });
    contasPagas.forEach((c) => {
      const chave = chaveMes(c.pagoEm);
      if (mapa[chave]) mapa[chave].despesas += Number(c.valor);
    });

    const serie = Object.values(mapa).map((m) => ({ ...m, saldo: m.receitas - m.despesas }));
    res.json(serie);
  } catch (err) {
    next(err);
  }
}

async function resumoPorCaixa(req, res, next) {
  try {
    const { de, ate } = req.query;
    const periodoVenda = {};
    const periodoPagar = {};
    if (de || ate) {
      periodoVenda.confirmadaEm = {};
      periodoPagar.pagoEm = {};
      if (de) {
        periodoVenda.confirmadaEm.gte = new Date(de);
        periodoPagar.pagoEm.gte = new Date(de);
      }
      if (ate) {
        const fim = new Date(ate);
        fim.setHours(23, 59, 59, 999);
        periodoVenda.confirmadaEm.lte = fim;
        periodoPagar.pagoEm.lte = fim;
      }
    }

    const [caixas, receitasPorCaixa, despesasPorCaixa] = await Promise.all([
      prisma.caixa.findMany({ orderBy: { id: 'asc' } }),
      prisma.venda.groupBy({
        by: ['caixaId'],
        where: { status: 'CONFIRMADA', ...periodoVenda },
        _sum: { total: true },
      }),
      prisma.contaPagar.groupBy({
        by: ['caixaId'],
        where: { pago: true, ...periodoPagar },
        _sum: { valor: true },
      }),
    ]);

    const receitaMap = new Map(receitasPorCaixa.map((r) => [r.caixaId, Number(r._sum.total || 0)]));
    const despesaMap = new Map(despesasPorCaixa.map((d) => [d.caixaId, Number(d._sum.valor || 0)]));

    const linhas = caixas.map((c) => {
      const receitas = receitaMap.get(c.id) || 0;
      const despesas = despesaMap.get(c.id) || 0;
      return { id: c.id, nome: c.nome, unidade: c.unidade, ativo: c.ativo, receitas, despesas, saldo: receitas - despesas };
    });

    const semUnidade = {
      receitas: receitaMap.get(null) || 0,
      despesas: despesaMap.get(null) || 0,
    };
    semUnidade.saldo = semUnidade.receitas - semUnidade.despesas;

    const total = linhas.reduce(
      (acc, l) => ({ receitas: acc.receitas + l.receitas, despesas: acc.despesas + l.despesas }),
      { receitas: semUnidade.receitas, despesas: semUnidade.despesas }
    );
    total.saldo = total.receitas - total.despesas;

    res.json({ caixas: linhas, semUnidade, total });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listarContasReceber,
  criarContaReceber,
  pagarContaReceber,
  listarContasPagar,
  criarContaPagar,
  pagarContaPagar,
  fluxoCaixa,
  resumoPorCaixa,
};
