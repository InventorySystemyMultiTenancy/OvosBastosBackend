const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./financeiro.controller');

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/contas-receber', ctrl.listarContasReceber);
router.post('/contas-receber', ctrl.criarContaReceber);
router.put('/contas-receber/:id/pagar', ctrl.pagarContaReceber);

router.get('/contas-pagar', ctrl.listarContasPagar);
router.post('/contas-pagar', ctrl.criarContaPagar);
router.put('/contas-pagar/:id/pagar', ctrl.pagarContaPagar);

router.get('/fluxo-caixa', ctrl.fluxoCaixa);

module.exports = router;
