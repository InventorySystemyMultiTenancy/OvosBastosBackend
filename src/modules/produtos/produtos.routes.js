const { Router } = require('express');
const { authenticate } = require('../../middleware/auth');
const { uploadImagemProduto } = require('../../config/upload');
const ctrl = require('./produtos.controller');

const router = Router();

router.use(authenticate);
router.get('/', ctrl.listar);
router.get('/:id', ctrl.obter);
router.post('/', ctrl.criar);
router.put('/:id', ctrl.atualizar);
router.post('/:id/imagem', uploadImagemProduto.single('imagem'), ctrl.enviarImagem);
router.delete('/:id', ctrl.remover);

module.exports = router;
