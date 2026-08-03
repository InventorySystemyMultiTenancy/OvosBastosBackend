const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./caixas.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.post('/', requireRole('ADMIN'), ctrl.criar);
router.put('/:id', requireRole('ADMIN'), ctrl.atualizar);

module.exports = router;
