const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./analiseReposicao.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.obter);

module.exports = router;
