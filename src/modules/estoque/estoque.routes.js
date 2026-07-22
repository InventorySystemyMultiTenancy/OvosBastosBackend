const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const ctrl = require('./estoque.controller');

const router = Router();

router.use(authenticate);
router.post('/entrada', ctrl.entrada);
router.post('/saida', ctrl.saida);
router.get('/historico', ctrl.historico);
router.get('/alertas', ctrl.alertas);

module.exports = router;
