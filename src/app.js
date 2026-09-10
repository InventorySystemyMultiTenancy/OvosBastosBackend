const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const clientesRoutes = require('./modules/clientes/clientes.routes');
const fornecedoresRoutes = require('./modules/fornecedores/fornecedores.routes');
const recebimentosRoutes = require('./modules/recebimentos/recebimentos.routes');
const produtosRoutes = require('./modules/produtos/produtos.routes');
const estoqueRoutes = require('./modules/estoque/estoque.routes');
const bandejasRoutes = require('./modules/bandejas/bandejas.routes');
const vendasRoutes = require('./modules/vendas/vendas.routes');
const caixasRoutes = require('./modules/caixas/caixas.routes');
const financeiroRoutes = require('./modules/financeiro/financeiro.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const analiseReposicaoRoutes = require('./modules/analiseReposicao/analiseReposicao.routes');
const lojaRoutes = require('./modules/loja/loja.routes');
const mercadopagoRoutes = require('./modules/mercadopago/mercadopago.routes');

const app = express();

// ETag automático do Express compara o corpo de cada resposta JSON com a anterior e, se forem
// idênticos, responde 304 sem corpo — ótimo pra assets estáticos, péssimo pra uma API que é
// consultada em polling (ex: status de pagamento na maquininha): o client trata 304 como erro
// (res.ok só é true pra 2xx) e descarta a resposta, então o poll nunca enxerga o estado real
// enquanto ele não mudar de um corpo pro próximo. Desliga pra toda a API.
app.set('etag', false);

const defaultOrigins = 'http://localhost:5173,https://vrillovos.selfmachine.com.br';
const allowedOrigins = (process.env.CORS_ORIGIN || defaultOrigins)
  .split(',')
  .map((origin) => origin.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
  })
);
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));

// Reforça o desligamento do ETag: sem cache HTTP em nenhuma resposta da API, nem por um proxy
// intermediário — cada requisição precisa refletir o estado atual do banco.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/loja', lojaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/fornecedores', fornecedoresRoutes);
app.use('/api/recebimentos', recebimentosRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/estoque', estoqueRoutes);
app.use('/api/bandejas', bandejasRoutes);
app.use('/api/vendas', vendasRoutes);
app.use('/api/caixas', caixasRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/dashboard/analise-reposicao', analiseReposicaoRoutes);
app.use('/api/mercadopago', mercadopagoRoutes);

app.use(errorHandler);

module.exports = app;
