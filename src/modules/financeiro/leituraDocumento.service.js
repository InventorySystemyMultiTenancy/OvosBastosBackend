// Leitura de conta a pagar por IA: recebe a foto ou o PDF de uma nota, boleto, recibo ou
// fatura e devolve os campos já no formato do formulário de "Nova conta a pagar". Não grava
// nada — o admin confere o que a IA leu e salva pelo fluxo normal (POST /contas-pagar).

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function montarPrompt() {
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    'Você lê documentos de despesas (notas fiscais, boletos, recibos, faturas de água/luz/internet, ' +
    'cupons) de uma distribuidora de ovos e extrai os dados para cadastrar uma conta a pagar. ' +
    `Hoje é ${hoje}. Responda SOMENTE com JSON válido, sem texto fora do JSON, no formato exato: ` +
    '{"descricao": string, "fornecedor": string|null, "valor": number|null, "dataEmissao": "AAAA-MM-DD"|null, ' +
    '"vencimento": "AAAA-MM-DD"|null, "pago": boolean, "dataPagamento": "AAAA-MM-DD"|null}. ' +
    'Regras: "descricao" é um resumo curto em português do que é a despesa (ex: "Conta de luz outubro", ' +
    '"Compra de embalagens"). "fornecedor" é o nome de quem emitiu/cobra (empresa ou pessoa), ou null se ' +
    'não aparecer. "valor" é o valor total a pagar em reais, como número (ex: 1234.56). "dataEmissao" é a ' +
    'data do documento/emissão. "vencimento" só se o documento mostrar uma data de vencimento. "pago" só é ' +
    'true se o documento indicar claramente que já foi pago (comprovante de pagamento, carimbo "PAGO", ' +
    'recibo de quitação, cupom fiscal de compra paga no ato); na dúvida, false. "dataPagamento" só se pago ' +
    'for true e a data aparecer. Nunca invente dados: use null para o que não estiver no documento.'
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

function normalizar(json) {
  const valor = Number(json.valor);
  const pago = json.pago === true;
  return {
    descricao: typeof json.descricao === 'string' && json.descricao.trim() ? json.descricao.trim() : '',
    fornecedor: typeof json.fornecedor === 'string' && json.fornecedor.trim() ? json.fornecedor.trim() : '',
    valor: Number.isFinite(valor) && valor > 0 ? Number(valor.toFixed(2)) : null,
    dataEmissao: dataValida(json.dataEmissao),
    vencimento: dataValida(json.vencimento),
    pago,
    dataPagamento: pago ? dataValida(json.dataPagamento) : null,
  };
}

async function lerDocumentoGasto(arquivo) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('Leitura por IA indisponível: OPENAI_API_KEY não configurada'), { status: 400 });
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
        { role: 'system', content: montarPrompt() },
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

  return normalizar(json);
}

module.exports = { lerDocumentoGasto };
