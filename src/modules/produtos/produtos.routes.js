const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./produtos.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.delete('/:id', ctrl.remover);

module.exports = router;
