const path = require('path');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const errorHandler = require('./middleware/errorHandler');
const authRoutes = require('./modules/auth/auth.routes');
const clientesRoutes = require('./modules/clientes/clientes.routes');
const produtosRoutes = require('./modules/produtos/produtos.routes');
const estoqueRoutes = require('./modules/estoque/estoque.routes');
const bandejasRoutes = require('./modules/bandejas/bandejas.routes');
const vendasRoutes = require('./modules/vendas/vendas.routes');
const financeiroRoutes = require('./modules/financeiro/financeiro.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const lojaRoutes = require('./modules/loja/loja.routes');

const app = express();

const defaultOrigins = 'http://localhost:5173,https://ovosbastos.selfmachine.com.br';
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

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/loja', lojaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/clientes', clientesRoutes);
app.use('/api/produtos', produtosRoutes);
app.use('/api/estoque', estoqueRoutes);
app.use('/api/bandejas', bandejasRoutes);
app.use('/api/vendas', vendasRoutes);
app.use('/api/financeiro', financeiroRoutes);
app.use('/api/dashboard', dashboardRoutes);

app.use(errorHandler);

module.exports = app;
