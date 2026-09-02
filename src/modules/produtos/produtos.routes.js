const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadImagemProduto } = require('../../config/upload');
const ctrl = require('./produtos.controller');
const embalagensCtrl = require('./embalagens.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.post('/:id/imagem', uploadImagemProduto.single('imagem'), ctrl.enviarImagem);
router.post('/:id/ativar-venda-unitaria', ctrl.ativarVendaPorUnidade);
router.delete('/:id', ctrl.remover);

router.get('/:id/embalagens', embalagensCtrl.listarPorProduto);
router.post('/:id/embalagens', embalagensCtrl.criar);
router.post('/:id/embalagens/:embalagemId/imagem', uploadImagemProduto.single('imagem'), embalagensCtrl.enviarImagem);
router.delete('/:id/embalagens/:embalagemId', embalagensCtrl.remover);

module.exports = router;
