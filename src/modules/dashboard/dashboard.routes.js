const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./dashboard.controller');

const router = Router();

router.get('/', authenticate, ctrl.resumo);
router.get('/reposicao-mensal', authenticate, ctrl.reposicaoMensal);
router.get('/estoque-por-unidade', authenticate, ctrl.estoquePorUnidade);
router.get('/lucro-por-unidade', authenticate, requireRole('ADMIN'), ctrl.lucroPorUnidade);

module.exports = router;
