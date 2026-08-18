const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./caixas.controller');
const mpCtrl = require('../mercadopago/mercadopago.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.post('/', requireRole('ADMIN'), ctrl.criar);
router.put('/:id', requireRole('ADMIN'), ctrl.atualizar);

router.post('/:id/mercadopago/token', requireRole('ADMIN'), mpCtrl.configurarToken);
router.get('/:id/mercadopago/devices', requireRole('ADMIN'), mpCtrl.listarDevices);
router.post('/:id/mercadopago/device', requireRole('ADMIN'), mpCtrl.associarDevice);
router.delete('/:id/mercadopago', requireRole('ADMIN'), mpCtrl.remover);

module.exports = router;
