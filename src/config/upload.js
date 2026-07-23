const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PASTA_UPLOADS = path.join(__dirname, '..', '..', 'public', 'uploads', 'produtos');
fs.mkdirSync(PASTA_UPLOADS, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_UPLOADS),
  filename: (req, file, cb) => {
    const extensao = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `produto-${req.params.id}-${Date.now()}${extensao}`);
  },
});

function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(Object.assign(new Error('Envie um arquivo de imagem'), { status: 400 }));
  }
  cb(null, true);
}

const uploadImagemProduto = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = { uploadImagemProduto, PASTA_UPLOADS };
