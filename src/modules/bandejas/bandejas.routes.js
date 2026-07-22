const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./bandejas.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:clienteId/historico', ctrl.historico);
router.post('/:clienteId/emprestimo', ctrl.emprestimo);
router.post('/:clienteId/devolucao', ctrl.devolucao);

module.exports = router;
