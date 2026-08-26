const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../config/db');
const cloudinary = require('../../config/cloudinary');

async function login(req, res, next) {
  try {
    const { email, senha } = req.body;
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario || !usuario.ativo) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const senhaOk = await bcrypt.compare(senha, usuario.senhaHash);
    if (!senhaOk) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, caixaId: usuario.caixaId, fotoUrl: usuario.fotoUrl },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, caixaId: usuario.caixaId, fotoUrl: usuario.fotoUrl },
    });
  } catch (err) {
    next(err);
  }
}

async function criarUsuario(req, res, next) {
  try {
    const { nome, email, senha, perfil, caixaId } = req.body;
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    if (caixaId && perfil === 'ADMIN') {
      return res.status(400).json({ error: 'Um login ADMIN não pode ser travado a um caixa' });
    }

    const senhaHash = await bcrypt.hash(senha, 10);
    const usuario = await prisma.usuario.create({
      data: { nome, email, senhaHash, perfil: perfil || 'VENDEDOR', caixaId: caixaId ? Number(caixaId) : null },
    });

    res.status(201).json({ id: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, caixaId: usuario.caixaId });
  } catch (err) {
    next(err);
  }
}

async function atualizarUsuario(req, res, next) {
  try {
    const { nome, perfil, ativo, caixaId, senha } = req.body;
    if (caixaId && perfil === 'ADMIN') {
      return res.status(400).json({ error: 'Um login ADMIN não pode ser travado a um caixa' });
    }

    const data = {};
    if (nome !== undefined) data.nome = nome;
    if (perfil !== undefined) data.perfil = perfil;
    if (ativo !== undefined) data.ativo = Boolean(ativo);
    if (caixaId !== undefined) data.caixaId = caixaId ? Number(caixaId) : null;
    if (senha) data.senhaHash = await bcrypt.hash(senha, 10);

    const usuario = await prisma.usuario.update({
      where: { id: Number(req.params.id) },
      data,
      select: { id: true, nome: true, email: true, perfil: true, ativo: true, caixaId: true },
    });
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

async function listarUsuarios(req, res, next) {
  try {
    const usuarios = await prisma.usuario.findMany({
      select: {
        id: true,
        nome: true,
        email: true,
        perfil: true,
        ativo: true,
        fotoUrl: true,
        createdAt: true,
        caixaId: true,
        caixa: { select: { nome: true, unidade: true } },
      },
      orderBy: { nome: 'asc' },
    });
    res.json(usuarios);
  } catch (err) {
    next(err);
  }
}

async function me(req, res) {
  res.json(req.usuario);
}

// Foto de perfil é autoatendimento — qualquer perfil logado (admin, vendedor, entregador)
// troca a própria foto, sem depender de um admin. Mesmo padrão de produtos.enviarImagem:
// public_id fixo por usuário, então reenviar substitui a foto anterior no Cloudinary.
async function enviarMinhaFoto(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie um arquivo de imagem' });

    const id = req.usuario.id;
    const resultado = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'ovosbastos/usuarios', public_id: `usuario-${id}`, overwrite: true, resource_type: 'image' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });

    const usuario = await prisma.usuario.update({
      where: { id },
      data: { fotoUrl: resultado.secure_url },
      select: { id: true, nome: true, email: true, perfil: true, caixaId: true, fotoUrl: true },
    });
    res.json(usuario);
  } catch (err) {
    next(err);
  }
}

module.exports = { login, criarUsuario, atualizarUsuario, listarUsuarios, me, enviarMinhaFoto };
