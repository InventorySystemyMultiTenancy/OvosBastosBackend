const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./vendas.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.post('/checkout', ctrl.checkout);
router.put('/:id/confirmar', ctrl.confirmar);
router.put('/:id/cancelar', ctrl.cancelar);
// Reabrir desfaz estoque e faturamento de uma venda já confirmada — só admin, mesmo padrão
// de outras ações financeiras sensíveis (divergência de caixa, gastos, etc.).
router.put('/:id/reabrir', requireRole('ADMIN'), ctrl.reabrir);
router.get('/:id/comprovante', ctrl.comprovante);

router.post('/:id/pagamento-maquininha', ctrl.pagarMaquininha);
router.delete('/:id/pagamento-maquininha', ctrl.cancelarPagamentoMaquininha);
router.get('/:id/pagamento-maquininha', ctrl.statusPagamentoMaquininha);

module.exports = router;
