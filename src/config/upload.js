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

// Mesma configuração — foto de perfil de usuário (qualquer perfil: admin, vendedor,
// entregador) enviando a própria foto.
const uploadFotoUsuario = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

// Foto ou PDF de uma conta/nota/boleto pra IA ler e virar conta a pagar (ver
// financeiro/leituraDocumento.service.js). Também só em memória — o arquivo vai direto pra
// OpenAI e não é guardado.
const uploadDocumentoGasto = multer({
  storage: multer.memoryStorage(),
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith('image/') && file.mimetype !== 'application/pdf') {
      return cb(Object.assign(new Error('Envie uma imagem ou um PDF'), { status: 400 }));
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { uploadImagemProduto, uploadFotoUsuario, uploadDocumentoGasto };
