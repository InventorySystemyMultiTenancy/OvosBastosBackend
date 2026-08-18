const { Router } = require('express');
const ctrl = require('./mercadopago.controller');

const router = Router();

// Rota pública: chamada pelo Mercado Pago, não pelo frontend. Sem middleware de autenticação.
router.post('/webhook', ctrl.webhook);

module.exports = router;
