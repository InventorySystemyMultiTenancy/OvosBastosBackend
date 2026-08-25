const { Router } = require('express');
const { authenticate, requireRole } = require('../../middleware/auth');
const ctrl = require('./financeiro.controller');

const router = Router();

router.use(authenticate, requireRole('ADMIN'));

router.get('/vendas-hoje-por-forma', ctrl.vendasHojePorForma);
router.get('/fornecedores-produtos', ctrl.fornecedoresProdutos);
router.get('/fornecedores-pagamentos', ctrl.fornecedoresPagamentos);

router.get('/contas-receber', ctrl.listarContasReceber);
router.post('/contas-receber', ctrl.criarContaReceber);
router.put('/contas-receber/:id/pagar', ctrl.pagarContaReceber);
router.post('/contas-receber/:id/receber-mes', ctrl.receberMesContaReceber);
router.put('/contas-receber/:id/cancelar-recorrencia', ctrl.cancelarRecorrenciaContaReceber);

router.get('/contas-pagar', ctrl.listarContasPagar);
router.post('/contas-pagar', ctrl.criarContaPagar);
router.put('/contas-pagar/:id/pagar', ctrl.pagarContaPagar);
router.post('/contas-pagar/:id/pagar-mes', ctrl.pagarMesContaPagar);
router.put('/contas-pagar/:id/cancelar-recorrencia', ctrl.cancelarRecorrenciaContaPagar);

router.get('/fluxo-caixa', ctrl.fluxoCaixa);
router.get('/resumo-caixas', ctrl.resumoPorCaixa);
router.get('/relatorio-periodo', ctrl.relatorioPeriodo);

router.get('/sessoes-caixa', ctrl.listarSessoesCaixa);
router.put('/sessoes-caixa/:id/revisar-divergencia', ctrl.revisarDivergenciaSessaoCaixa);

module.exports = router;
