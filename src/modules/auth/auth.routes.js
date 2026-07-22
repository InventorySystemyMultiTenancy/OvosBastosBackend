const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./auth.controller');

const router = Router();

router.post('/login', ctrl.login);
router.get('/me', authenticate, ctrl.me);
router.get('/usuarios', authenticate, requireRole('ADMIN'), ctrl.listarUsuarios);
router.post('/usuarios', authenticate, requireRole('ADMIN'), ctrl.criarUsuario);

module.exports = router;
