const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./dashboard.controller');

const router = Router();

router.get('/', authenticate, ctrl.resumo);

module.exports = router;
