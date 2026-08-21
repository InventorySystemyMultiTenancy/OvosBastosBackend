const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./recebimentos.controller');

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id/fornecedor', ctrl.definirFornecedor);
router.post('/:id/distribuir', ctrl.distribuir);
router.post('/:id/pagamentos', ctrl.pagar);

module.exports = router;
