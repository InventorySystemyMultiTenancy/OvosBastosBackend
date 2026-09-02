const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadImagemProduto } = require('../../config/upload');
const ctrl = require('./produtos.controller');
const niveisCtrl = require('./niveisVenda.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.post('/:id/imagem', uploadImagemProduto.single('imagem'), ctrl.enviarImagem);
router.delete('/:id', ctrl.remover);

router.get('/:id/niveis', niveisCtrl.listarPorProduto);
router.post('/:id/niveis', niveisCtrl.criar);
router.put('/:id/niveis/:nivelId', niveisCtrl.atualizar);
router.post('/:id/niveis/:nivelId/definir-base', niveisCtrl.definirBase);
router.post('/:id/niveis/:nivelId/recalcular', niveisCtrl.recalcular);
router.post('/:id/niveis/:nivelId/imagem', uploadImagemProduto.single('imagem'), niveisCtrl.enviarImagem);
router.delete('/:id/niveis/:nivelId', niveisCtrl.remover);

module.exports = router;
