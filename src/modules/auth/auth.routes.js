const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const { uploadFotoUsuario } = require('../../config/upload');
const ctrl = require('./auth.controller');

const router = Router();

router.post('/login', ctrl.login);
router.get('/me', authenticate, ctrl.me);
router.post('/me/foto', authenticate, uploadFotoUsuario.single('foto'), ctrl.enviarMinhaFoto);
router.get('/usuarios', authenticate, requireRole('ADMIN'), ctrl.listarUsuarios);
router.post('/usuarios', authenticate, requireRole('ADMIN'), ctrl.criarUsuario);
router.put('/usuarios/:id', authenticate, requireRole('ADMIN'), ctrl.atualizarUsuario);

module.exports = router;
