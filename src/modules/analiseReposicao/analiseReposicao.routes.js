const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./analiseReposicao.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.obter);
router.post('/gerar', requireRole('ADMIN'), ctrl.gerar);

module.exports = router;
