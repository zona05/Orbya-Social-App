const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const Post = require('../models/Post');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const router = express.Router();

// Configurar nodemailer
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Registrar usuario
router.post('/register', [
  body('username')
    .isLength({ min: 3, max: 20 })
    .withMessage('El nombre de usuario debe tener entre 3 y 20 caracteres')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('El nombre de usuario solo puede contener letras, números y guiones bajos'),
  body('email').isEmail().withMessage('Email no válido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Datos de registro no válidos',
        errors: errors.array()
      });
    }

    const { username, email, password } = req.body;

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ message: 'Este email ya está registrado' });
      }
      if (existingUser.username === username) {
        return res.status(400).json({ message: 'Este nombre de usuario ya está en uso' });
      }
    }

    // Crear nuevo usuario
    const user = new User({ username, email, password });
    await user.save();

    // Generar token JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture,
        theme: user.theme
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Iniciar sesión
router.post('/login', [
  body('email').isEmail().withMessage('Email no válido'),
  body('password').notEmpty().withMessage('Contraseña requerida')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Datos de inicio de sesión no válidos',
        errors: errors.array()
      });
    }

    const { email, password } = req.body;

    // Buscar usuario por email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Verificar contraseña
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // Generar token JWT
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || 'fallback_secret_key',
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Inicio de sesión exitoso',
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        profilePicture: user.profilePicture ? 
          `${req.protocol}://${req.get('host')}/uploads/profiles/${user.profilePicture}` : null,
        theme: user.theme
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Verificar autenticación
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    const userData = {
      id: user._id,
      username: user.username,
      email: user.email,
      profilePicture: user.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${user.profilePicture}` : null,
      description: user.description,
      gender: user.gender,
      age: user.age,
      studies: user.studies,
      theme: user.theme,
      createdAt: user.createdAt
    };

    res.json({ user: userData });
  } catch (error) {
    console.error('Error verificando autenticación:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Solicitar recuperación de contraseña
router.post('/forgot-password', [
  body('email').isEmail().withMessage('Email no válido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Email no válido',
        errors: errors.array()
      });
    }

    const { email } = req.body;
    const user = await User.findOne({ email });

    // Siempre responder con éxito por seguridad (no revelar si el email existe)
    const successMessage = 'Si el correo electrónico está registrado, recibirás un enlace de recuperación.';

    if (!user) {
      return res.json({ message: successMessage });
    }

    // Generar token seguro
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 30 * 60 * 1000); // 30 minutos

    // Guardar token en la base de datos
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = resetTokenExpiry;
    await user.save();

    // Crear enlace de recuperación
    const resetURL = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${resetToken}`;

    // Configurar email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: 'Recuperación de contraseña - Orbya',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #1877f2 0%, #42a5f5 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
            .content { background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; }
            .button { display: inline-block; background: #1877f2; color: white; padding: 12px 30px; text-decoration: none; border-radius: 8px; margin: 20px 0; }
            .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
            .warning { background: #fff3cd; border: 1px solid #ffeaa7; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 Recuperación de Contraseña</h1>
              <p>Orbya</p>
            </div>
            <div class="content">
              <h2>Hola ${user.username},</h2>
              <p>Hemos recibido una solicitud para restablecer la contraseña de tu cuenta en Orbya.</p>
              
              <p>Si solicitaste este cambio, haz clic en el siguiente botón para crear una nueva contraseña:</p>
              
              <div style="text-align: center;">
                <a href="${resetURL}" class="button">Restablecer Contraseña</a>
              </div>
              
              <div class="warning">
                <strong>⚠️ Importante:</strong>
                <ul>
                  <li>Este enlace expirará en 30 minutos</li>
                  <li>Solo puede usarse una vez</li>
                  <li>Si no solicitaste este cambio, ignora este correo</li>
                </ul>
              </div>
              
              <p>Si el botón no funciona, copia y pega el siguiente enlace en tu navegador:</p>
              <p style="word-break: break-all; background: #e9ecef; padding: 10px; border-radius: 5px;">
                ${resetURL}
              </p>
            </div>
            <div class="footer">
              <p>Este correo fue enviado desde Orbya</p>
              <p>Si no solicitaste este cambio, tu cuenta sigue siendo segura.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };

    // Enviar email
    await transporter.sendMail(mailOptions);

    res.json({ message: successMessage });

  } catch (error) {
    console.error('Error en recuperación de contraseña:', error);
    res.status(500).json({ message: 'Error del servidor. Inténtalo más tarde.' });
  }
});

// Restablecer contraseña
router.post('/reset-password', [
  body('token').notEmpty().withMessage('Token requerido'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Datos no válidos',
        errors: errors.array()
      });
    }

    const { token, password } = req.body;

    // Buscar usuario con token válido y no expirado
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ 
        message: 'Token inválido o expirado. Solicita una nueva recuperación de contraseña.' 
      });
    }

    // Actualizar contraseña (el middleware pre('save') se encargará del hash)
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    res.json({ message: 'Contraseña actualizada exitosamente. Ya puedes iniciar sesión.' });

  } catch (error) {
    console.error('Error al restablecer contraseña:', error);
    res.status(500).json({ message: 'Error del servidor. Inténtalo más tarde.' });
  }
});

// Verificar token de recuperación
router.get('/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;

    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ 
        valid: false,
        message: 'Token inválido o expirado' 
      });
    }

    res.json({ 
      valid: true,
      message: 'Token válido' 
    });

  } catch (error) {
    console.error('Error verificando token:', error);
    res.status(500).json({ 
      valid: false,
      message: 'Error del servidor' 
    });
  }
});

// Eliminar cuenta de usuario
router.delete('/delete-account', auth, async (req, res) => {
  try {
    const userId = req.user._id;
    const currentUser = req.user;

    console.log(`Iniciando eliminación de cuenta para usuario: ${currentUser.username} (ID: ${userId})`);

    // 1. Eliminar todos los posts del usuario
    const userPosts = await Post.find({ author: userId });
    console.log(`Eliminando ${userPosts.length} posts del usuario`);
    
    for (const post of userPosts) {
      // Emitir evento de socket para posts eliminados
      if (req.app.get('socketio')) {
        req.app.get('socketio').emit('post_deleted', { postId: post._id });
      }
    }
    await Post.deleteMany({ author: userId });

    // 2. Eliminar likes del usuario en posts de otros usuarios
    await Post.updateMany(
      { 'likes.user': userId },
      { $pull: { likes: { user: userId } } }
    );

    // 3. Actualizar likesCount en todos los posts afectados
    const postsWithLikes = await Post.find({ 'likes.user': { $exists: true } });
    for (const post of postsWithLikes) {
      post.likesCount = post.likes.length;
      await post.save();
    }

    // 4. Eliminar el usuario de las listas de seguidores y seguidos
    await User.updateMany(
      { followers: userId },
      { $pull: { followers: userId } }
    );
    
    await User.updateMany(
      { following: userId },
      { $pull: { following: userId } }
    );

    // 5. Eliminar conversaciones donde el usuario es participante
    const userConversations = await Conversation.find({ participants: userId });
    for (const conversation of userConversations) {
      // Marcar mensajes como eliminados en lugar de borrarlos completamente
      await Message.updateMany(
        { conversation: conversation._id, sender: userId },
        { 
          isDeleted: true, 
          deletedAt: new Date(),
          content: '[Usuario eliminado]'
        }
      );
      
      // Si la conversación solo tiene 2 participantes, eliminarla completamente
      if (conversation.participants.length === 2) {
        await Message.deleteMany({ conversation: conversation._id });
        await Conversation.findByIdAndDelete(conversation._id);
      } else {
        // Si hay más participantes, solo remover al usuario
        await Conversation.findByIdAndUpdate(
          conversation._id,
          { $pull: { participants: userId } }
        );
      }
    }

    // 6. Eliminar archivos físicos del usuario (foto de perfil)
    const fs = require('fs');
    const path = require('path');
    
    if (currentUser.profilePicture) {
      const profilePicPath = path.join(__dirname, '../uploads/profiles/', currentUser.profilePicture);
      try {
        if (fs.existsSync(profilePicPath)) {
          fs.unlinkSync(profilePicPath);
          console.log(`Foto de perfil eliminada: ${profilePicPath}`);
        }
      } catch (error) {
        console.error('Error eliminando foto de perfil:', error);
      }
    }

    // 7. Finalmente, eliminar el usuario
    await User.findByIdAndDelete(userId);

    console.log(`Cuenta del usuario ${currentUser.username} eliminada exitosamente`);

    res.json({ 
      message: 'Cuenta eliminada exitosamente',
      redirectTo: '/login'
    });

  } catch (error) {
    console.error('Error eliminando cuenta:', error);
    res.status(500).json({ message: 'Error del servidor al eliminar la cuenta' });
  }
});

// Verificar contraseña antes de eliminar cuenta
router.post('/verify-password-for-deletion', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Contraseña incorrecta' });
    }

    res.json({ message: 'Contraseña verificada exitosamente' });
  } catch (error) {
    console.error('Error verificando contraseña:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;