const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./caixas.controller');
const mpCtrl = require('../mercadopago/mercadopago.controller');
const sessoesCtrl = require('./sessoesCaixa.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id/estoque', ctrl.estoquePorCaixa);
router.post('/', requireRole('ADMIN'), ctrl.criar);
router.put('/:id', requireRole('ADMIN'), ctrl.atualizar);

router.get('/:id/sessao-atual', sessoesCtrl.sessaoAtual);
router.post('/:id/sessoes/abrir', sessoesCtrl.abrir);
router.put('/:id/sessoes/fechar', sessoesCtrl.fechar);
router.get('/:id/sessoes', requireRole('ADMIN'), sessoesCtrl.listarPorCaixa);

router.post('/:id/mercadopago/token', requireRole('ADMIN'), mpCtrl.configurarToken);
router.get('/:id/mercadopago/devices', requireRole('ADMIN'), mpCtrl.listarDevices);
router.post('/:id/mercadopago/device', requireRole('ADMIN'), mpCtrl.associarDevice);
router.delete('/:id/mercadopago', requireRole('ADMIN'), mpCtrl.remover);

module.exports = router;
