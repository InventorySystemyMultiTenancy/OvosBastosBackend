const multer = require('multer');

function fileFilter(req, file, cb) {
  if (!file.mimetype.startsWith('image/')) {
    return cb(Object.assign(new Error('Envie um arquivo de imagem'), { status: 400 }));
  }
  cb(null, true);
}

// Guarda o arquivo em memória (buffer) — nada é escrito em disco. O disco do
// serviço na Render é efêmero (some a cada deploy/restart), então o upload
// segue direto pro Cloudinary a partir do buffer.
const uploadImagemProduto = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = { uploadImagemProduto };
