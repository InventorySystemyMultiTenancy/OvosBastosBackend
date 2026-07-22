const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./vendas.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id/confirmar', ctrl.confirmar);
router.put('/:id/cancelar', ctrl.cancelar);
router.get('/:id/comprovante', ctrl.comprovante);

module.exports = router;
