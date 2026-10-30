const prisma = require('../../config/db');

// Leitura de conta a pagar por IA: recebe a foto ou o PDF de uma nota, boleto, recibo ou
// fatura e devolve os campos já no formato do formulário de "Nova conta a pagar". Se for uma
// compra de produtos do catálogo, devolve também os itens (produto, nível, quantidade, valor)
// pra entrarem no estoque. Não grava nada — o admin confere o que a IA leu e salva pelo fluxo
// normal (POST /contas-pagar), que é quem dá a entrada no estoque e atualiza o custo.

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

async function carregarCatalogo() {
  const produtos = await prisma.produto.findMany({
    where: { ativo: true },
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      tipo: true,
      niveisVenda: {
        where: { ativo: true },
        orderBy: { quantidadeGrao: 'asc' },
        select: { id: true, nome: true, quantidadeGrao: true },
      },
    },
  });
  return produtos;
}

function montarPrompt(catalogo) {
  const hoje = new Date().toISOString().slice(0, 10);
  const catalogoPrompt = catalogo.map((p) => ({
    produtoId: p.id,
    nome: p.nome,
    tipo: p.tipo || undefined,
    niveis: p.niveisVenda.map((n) => ({ nivelVendaId: n.id, nome: n.nome, unidadesBase: n.quantidadeGrao })),
  }));

  return (
    'Você lê documentos de despesas (notas fiscais, boletos, recibos, faturas de água/luz/internet, ' +
    'cupons, pedidos de compra) de uma distribuidora de ovos e extrai os dados para cadastrar uma conta a ' +
    `pagar. Hoje é ${hoje}. Responda SOMENTE com JSON válido, sem texto fora do JSON, no formato exato: ` +
    '{"descricao": string, "fornecedor": string|null, "valor": number|null, "dataEmissao": "AAAA-MM-DD"|null, ' +
    '"vencimento": "AAAA-MM-DD"|null, "pago": boolean, "dataPagamento": "AAAA-MM-DD"|null, ' +
    '"itens": [{"descricao": string, "produtoId": number|null, "nivelVendaId": number|null, ' +
    '"quantidade": number, "unidadesBaseTotal": number|null, "valorUnitario": number|null}]}. ' +
    'Regras gerais: "descricao" é um resumo curto em português do que é a despesa (ex: "Conta de luz outubro", ' +
    '"Compra de ovos"). "fornecedor" é o nome de quem emitiu/cobra (empresa ou pessoa), ou null se ' +
    'não aparecer. "valor" é o valor total a pagar em reais, como número (ex: 1234.56). "dataEmissao" é a ' +
    'data do documento/emissão. "vencimento" só se o documento mostrar uma data de vencimento. "pago" só é ' +
    'true se o documento indicar claramente que já foi pago (comprovante de pagamento, carimbo "PAGO", ' +
    'recibo de quitação, cupom fiscal de compra paga no ato); na dúvida, false. "dataPagamento" só se pago ' +
    'for true e a data aparecer. Nunca invente dados: use null para o que não estiver no documento. ' +
    'Regras dos itens: se o documento for uma compra de mercadorias, liste em "itens" cada linha comprada. ' +
    'Compare cada linha com o CATÁLOGO abaixo pelo nome/significado (ex: "OVOS EXTRA BRANCO" pode ser o ' +
    'produto "Ovo Branco Extra"). "produtoId" é o do catálogo, ou null se a linha não ' +
    'corresponder com segurança a nenhum produto. "nivelVendaId" é o nível do catálogo na mesma embalagem em ' +
    'que o documento conta a quantidade (unidade de medida "CX" = nível "Caixa" daquele produto; também ' +
    'bandeja, dúzia, unidade...), e "quantidade" é quantas dessa embalagem chegaram (coluna Qtde; ' +
    '"5,000" = 5). Se a embalagem do documento não bater com nenhum nível, use nivelVendaId null ' +
    'e informe em "unidadesBaseTotal" o total de unidades-base (ex: ovos) que chegaram, se der para calcular ' +
    'com segurança pelo documento. "valorUnitario" é o preço de UMA embalagem daquela linha, exatamente como ' +
    'na coluna de valor unitário (ex: "Vlr.Unitário"), SEM aplicar descontos/acréscimos da linha; se o ' +
    'documento só mostrar o total da linha, divida pela quantidade. ' +
    'Se não for compra de mercadorias (conta de luz, aluguel, serviço), "itens" é []. ' +
    `CATÁLOGO: ${JSON.stringify(catalogoPrompt)}`
  );
}

function parteDoArquivo(arquivo) {
  const base64 = arquivo.buffer.toString('base64');
  const dataUrl = `data:${arquivo.mimetype};base64,${base64}`;
  if (arquivo.mimetype === 'application/pdf') {
    return { type: 'file', file: { filename: arquivo.originalname || 'documento.pdf', file_data: dataUrl } };
  }
  return { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } };
}

function dataValida(valor) {
  if (typeof valor !== 'string' || !DATA_ISO.test(valor)) return null;
  return Number.isNaN(new Date(valor).getTime()) ? null : valor;
}

function numeroPositivo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Cruza os itens da IA com o catálogo de verdade: descarta ids inventados e devolve a
// quantidade sempre num nível existente ou, sem nível, direto em grão-base (nivelVendaId null).
function normalizarItens(itensIA, catalogo) {
  const itens = [];
  const naoIdentificados = [];
  if (!Array.isArray(itensIA)) return { itens, naoIdentificados };

  const produtosPorId = new Map(catalogo.map((p) => [p.id, p]));
  itensIA.forEach((item) => {
    const descricao = typeof item.descricao === 'string' ? item.descricao.trim() : '';
    const produto = produtosPorId.get(Number(item.produtoId));
    if (!produto) {
      if (descricao) naoIdentificados.push(descricao);
      return;
    }

    const valorUnitario = numeroPositivo(item.valorUnitario);
    const nivel = produto.niveisVenda.find((n) => n.id === Number(item.nivelVendaId));
    const quantidade = numeroPositivo(item.quantidade);
    if (nivel && quantidade && Number.isInteger(quantidade)) {
      itens.push({ descricao, produtoId: produto.id, nivelVendaId: nivel.id, quantidade, valorUnitario });
      return;
    }

    // Sem nível correspondente: quantidade vira grão-base e o valor unitário é reescalado de
    // "por embalagem do documento" pra "por grão-base", pra manter quantidade × valor igual.
    const unidadesBase = numeroPositivo(item.unidadesBaseTotal);
    if (unidadesBase && Number.isInteger(unidadesBase)) {
      const valorPorGrao = valorUnitario && quantidade ? Number(((valorUnitario * quantidade) / unidadesBase).toFixed(6)) : null;
      itens.push({ descricao, produtoId: produto.id, nivelVendaId: null, quantidade: unidadesBase, valorUnitario: valorPorGrao });
      return;
    }

    naoIdentificados.push(descricao || produto.nome);
  });

  return { itens, naoIdentificados };
}

function normalizar(json, catalogo) {
  const valor = Number(json.valor);
  const pago = json.pago === true;
  const { itens, naoIdentificados } = normalizarItens(json.itens, catalogo);
  return {
    descricao: typeof json.descricao === 'string' && json.descricao.trim() ? json.descricao.trim() : '',
    fornecedor: typeof json.fornecedor === 'string' && json.fornecedor.trim() ? json.fornecedor.trim() : '',
    valor: Number.isFinite(valor) && valor > 0 ? Number(valor.toFixed(2)) : null,
    dataEmissao: dataValida(json.dataEmissao),
    vencimento: dataValida(json.vencimento),
    pago,
    dataPagamento: pago ? dataValida(json.dataPagamento) : null,
    itensEstoque: itens,
    itensNaoIdentificados: naoIdentificados,
  };
}

async function lerDocumentoGasto(arquivo) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('Leitura por IA indisponível: OPENAI_API_KEY não configurada'), { status: 400 });
  }
  const modelo = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const catalogo = await carregarCatalogo();

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      messages: [
        { role: 'system', content: montarPrompt(catalogo) },
        {
          role: 'user',
          content: [{ type: 'text', text: 'Extraia os dados da conta a pagar deste documento.' }, parteDoArquivo(arquivo)],
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
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

  return normalizar(json, catalogo);
}

module.exports = { lerDocumentoGasto };
