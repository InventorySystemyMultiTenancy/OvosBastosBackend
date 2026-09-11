// Grava a trilha de auditoria de edições no catálogo (nome, preço de custo, preço de nível de
// venda) — ver HistoricoAlteracao no schema. `db` é o prisma client normal ou um `tx` de dentro
// de um $transaction, pra registrar sempre junto com a alteração de verdade, nunca separado.
// `alteracoes` é uma lista de { campo, valorAntigo, valorNovo }; campos que não mudaram (mesmo
// valor antes/depois) são descartados aqui, então quem chama pode passar o form inteiro sem se
// preocupar em filtrar o que realmente mudou.
function normalizar(valor) {
  return valor === null || valor === undefined ? '' : String(valor);
}

async function registrarAlteracoes(db, { produtoId, entidade, entidadeId, usuarioId, motivo, alteracoes }) {
  const linhas = alteracoes
    .filter((a) => normalizar(a.valorAntigo) !== normalizar(a.valorNovo))
    .map((a) => ({
      produtoId,
      entidade,
      entidadeId,
      campo: a.campo,
      valorAntigo: a.valorAntigo === null || a.valorAntigo === undefined ? null : String(a.valorAntigo),
      valorNovo: a.valorNovo === null || a.valorNovo === undefined ? null : String(a.valorNovo),
      usuarioId: usuarioId || null,
      motivo: motivo || null,
    }));

  if (linhas.length === 0) return;
  await db.historicoAlteracao.createMany({ data: linhas });
}

module.exports = { registrarAlteracoes };
