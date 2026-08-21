const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./fornecedores.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.remover);

router.get('/:id/precos', requireRole('ADMIN'), ctrl.listarPrecos);
router.put('/:id/precos', requireRole('ADMIN'), ctrl.salvarPrecos);

module.exports = router;
