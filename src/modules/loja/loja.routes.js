const { Router } = require('express');
const ctrl = require('./loja.controller');

const router = Router();

// Rota pública — loja de e-commerce, sem autenticação.
router.get('/catalogo', ctrl.listarCatalogo);
router.post('/pedidos', ctrl.criarPedido);

module.exports = router;
