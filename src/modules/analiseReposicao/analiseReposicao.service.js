const prisma = require('../../config/db');

const DIAS_VELOCIDADE_ESTOQUE = 7;
const TOP_ITENS = 10;

// Segunda-feira da semana atual, hora zerada — chave de cache da análise (uma linha por
// semana, não por dia).
function inicioDaSemana() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const diaSemana = d.getDay(); // 0=domingo .. 6=sábado
  const deslocamento = diaSemana === 0 ? 6 : diaSemana - 1;
  d.setDate(d.getDate() - deslocamento);
  return d;
}

// Mesma consulta/redução que antes vivia inline em dashboard.controller.js: velocidade de
// venda dos últimos 7 dias por (unidade, produto) contra o estoque atual daquela unidade.
// Sem filtro de urgência aqui de propósito — a IA (ou o fallback determinístico) decide o
// que vale a pena destacar a partir do panorama completo.
async function calcularDadosBrutos() {
  const desde = new Date();
  desde.setDate(desde.getDate() - (DIAS_VELOCIDADE_ESTOQUE - 1));
  desde.setHours(0, 0, 0, 0);

  const [itensVelocidade, estoquesCaixaAtivo] = await Promise.all([
    prisma.itemVenda.findMany({
      where: { venda: { status: 'CONFIRMADA', confirmadaEm: { gte: desde }, caixaId: { not: null } } },
      select: {
        quantidade: true,
        produtoId: true,
        produto: { select: { nome: true } },
        venda: { select: { caixaId: true, caixa: { select: { nome: true, unidade: true } } } },
      },
    }),
    prisma.estoqueCaixa.findMany({
      where: { caixa: { ativo: true } },
      select: { produtoId: true, caixaId: true, quantidade: true },
    }),
  ]);

  const mapaVelocidade = {};
  itensVelocidade.forEach((i) => {
    const chave = `${i.venda.caixaId}-${i.produtoId}`;
    if (!mapaVelocidade[chave]) {
      mapaVelocidade[chave] = {
        caixaId: i.venda.caixaId,
        caixaNome: i.venda.caixa?.nome || 'Sem caixa',
        caixaUnidade: i.venda.caixa?.unidade || null,
        produtoId: i.produtoId,
        produtoNome: i.produto.nome,
        vendidoSemana: 0,
      };
    }
    mapaVelocidade[chave].vendidoSemana += i.quantidade;
  });

  const mapaEstoque = {};
  estoquesCaixaAtivo.forEach((e) => {
    mapaEstoque[`${e.caixaId}-${e.produtoId}`] = e.quantidade;
  });

  return Object.values(mapaVelocidade).map((v) => {
    const velocidadeDiaria = v.vendidoSemana / DIAS_VELOCIDADE_ESTOQUE;
    const estoqueAtual = mapaEstoque[`${v.caixaId}-${v.produtoId}`] || 0;
    const coberturaDias = velocidadeDiaria > 0 ? estoqueAtual / velocidadeDiaria : Infinity;
    return { ...v, velocidadeDiaria, estoqueAtual, coberturaDias };
  });
}

// Fallback sem IA: mesma regra fixa que existia antes (cobertura < 3 dias), usada quando a
// OpenAI não está configurada ou falha e não há nenhuma análise anterior salva.
function calcularFallbackDeterministico(dadosBrutos) {
  const LIMITE_DIAS_COBERTURA = 3;
  const itens = dadosBrutos
    .filter((v) => v.velocidadeDiaria > 0 && v.coberturaDias < LIMITE_DIAS_COBERTURA)
    .sort((a, b) => a.coberturaDias - b.coberturaDias)
    .slice(0, TOP_ITENS)
    .map((v) => ({
      caixaId: v.caixaId,
      produtoId: v.produtoId,
      produtoNome: v.produtoNome,
      caixaNome: v.caixaNome,
      caixaUnidade: v.caixaUnidade,
      estoqueAtual: v.estoqueAtual,
      coberturaDias: v.coberturaDias === Infinity ? null : v.coberturaDias,
      urgencia: v.coberturaDias <= 1 ? 'alta' : 'media',
      motivo: null,
    }));
  return { resumo: null, itens };
}

function montarPrompt(dadosBrutos) {
  const linhas = dadosBrutos.map((v) => ({
    caixaId: v.caixaId,
    produtoId: v.produtoId,
    produto: v.produtoNome,
    unidade: v.caixaNome,
    estoqueAtual: v.estoqueAtual,
    vendidoUltimos7Dias: v.vendidoSemana,
    velocidadeDiaria: Number(v.velocidadeDiaria.toFixed(2)),
    coberturaDiasAtual: v.coberturaDias === Infinity ? null : Number(v.coberturaDias.toFixed(1)),
  }));

  const sistema =
    'Você é a Clara, a assistente de IA da Vrill Ovos — uma colega de confiança que cuida da reposição ' +
    'de estoque entre as unidades. Recebe, por unidade de venda, a velocidade de venda dos últimos 7 dias ' +
    'e o estoque atual de cada produto, e decide quais combinações de unidade+produto merecem alerta de ' +
    'reposição agora. Escreva o "resumo" na primeira pessoa, com tom caloroso e direto, como alguém do ' +
    'time avisando os colegas — sem exagerar na informalidade. Responda SOMENTE com JSON válido, sem texto ' +
    'fora do JSON, no formato exato: ' +
    '{"resumo": "um parágrafo curto em português avaliando a situação geral", ' +
    '"itens": [{"caixaId": number, "produtoId": number, "urgencia": "alta"|"media"|"baixa", "motivo": "1-2 frases em português"}]}. ' +
    `No máximo ${TOP_ITENS} itens, ordenados da urgência mais alta pra mais baixa. Só inclua itens que realmente precisam de atenção — não force ${TOP_ITENS} se não houver tantos.`;

  const usuario = `Dados dos últimos ${DIAS_VELOCIDADE_ESTOQUE} dias (um item por unidade+produto com venda recente):\n${JSON.stringify(linhas)}`;

  return { sistema, usuario };
}

async function chamarOpenAI({ sistema, usuario }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('OPENAI_API_KEY não configurada'), { status: 400 });
  }
  const modelo = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: 'system', content: sistema },
        { role: 'user', content: usuario },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = (data && data.error && data.error.message) || `Erro OpenAI (${res.status})`;
    throw Object.assign(new Error(msg), { status: 502 });
  }

  const conteudo = data?.choices?.[0]?.message?.content;
  if (!conteudo) throw Object.assign(new Error('Resposta da OpenAI sem conteúdo'), { status: 502 });

  let json;
  try {
    json = JSON.parse(conteudo);
  } catch {
    throw Object.assign(new Error('Resposta da OpenAI não é um JSON válido'), { status: 502 });
  }
  if (!Array.isArray(json.itens)) {
    throw Object.assign(new Error('JSON da OpenAI fora do formato esperado'), { status: 502 });
  }

  return { resumo: typeof json.resumo === 'string' ? json.resumo : null, itens: json.itens, modelo };
}

// Cruza a resposta da IA (que só sabe caixaId/produtoId/urgencia/motivo) de volta com os
// dados brutos, pra preencher nome/estoque/cobertura sem pedir isso de novo pro modelo.
function enriquecerItensIA(itensIA, dadosBrutos) {
  const mapaBrutos = new Map(dadosBrutos.map((v) => [`${v.caixaId}-${v.produtoId}`, v]));
  return itensIA
    .map((item) => {
      const bruto = mapaBrutos.get(`${item.caixaId}-${item.produtoId}`);
      if (!bruto) return null;
      return {
        caixaId: bruto.caixaId,
        produtoId: bruto.produtoId,
        produtoNome: bruto.produtoNome,
        caixaNome: bruto.caixaNome,
        caixaUnidade: bruto.caixaUnidade,
        estoqueAtual: bruto.estoqueAtual,
        coberturaDias: bruto.coberturaDias === Infinity ? null : bruto.coberturaDias,
        urgencia: ['alta', 'media', 'baixa'].includes(item.urgencia) ? item.urgencia : 'media',
        motivo: typeof item.motivo === 'string' ? item.motivo : null,
      };
    })
    .filter(Boolean)
    .slice(0, TOP_ITENS);
}

async function gerarAnaliseDaSemana() {
  const inicioSemana = inicioDaSemana();

  const existente = await prisma.analiseReposicaoIA.findUnique({ where: { data: inicioSemana } });
  if (existente) return existente;

  const dadosBrutos = await calcularDadosBrutos();

  if (dadosBrutos.length === 0) {
    return prisma.analiseReposicaoIA.upsert({
      where: { data: inicioSemana },
      create: { data: inicioSemana, resumo: null, itens: [] },
      update: { resumo: null, itens: [], geradoEm: new Date() },
    });
  }

  const { sistema, usuario } = montarPrompt(dadosBrutos);
  const resultado = await chamarOpenAI({ sistema, usuario });
  const itens = enriquecerItensIA(resultado.itens, dadosBrutos);

  return prisma.analiseReposicaoIA.upsert({
    where: { data: inicioSemana },
    create: { data: inicioSemana, resumo: resultado.resumo, itens, modelo: resultado.modelo },
    update: { resumo: resultado.resumo, itens, modelo: resultado.modelo, geradoEm: new Date() },
  });
}

async function obterAnaliseAtual() {
  try {
    const analise = await gerarAnaliseDaSemana();
    return { ...analise, stale: false, modoFallback: false };
  } catch (err) {
    console.error('Falha ao gerar análise de reposição por IA:', err.message);

    const ultima = await prisma.analiseReposicaoIA.findFirst({ orderBy: { data: 'desc' } });
    if (ultima) return { ...ultima, stale: true, modoFallback: false };

    const dadosBrutos = await calcularDadosBrutos();
    const fallback = calcularFallbackDeterministico(dadosBrutos);
    return { id: null, data: inicioDaSemana(), geradoEm: new Date(), modelo: null, ...fallback, stale: false, modoFallback: true };
  }
}

module.exports = { obterAnaliseAtual };
