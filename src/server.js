require('dotenv').config();

// A loja opera no horário de Brasília, mas o servidor (Render) roda em UTC. Sem isso, todo
// cálculo com getHours/getDate/"hoje"/início do mês sai 3h adiantado (ex: venda das 18h
// aparecia como 21h no gráfico por hora). Precisa vir antes de qualquer uso de Date.
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`EggControl API rodando em http://localhost:${PORT}`);
});
