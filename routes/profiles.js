const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Post = require('../models/Post');
const auth = require('../middleware/auth');
const jwt = require('jsonwebtoken');

const router = express.Router();

// Configuración de multer para fotos de perfil
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/profiles/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + req.user._id + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Solo se permiten archivos de imagen'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB límite
  }
});

// Obtener perfil público por username - ACTUALIZADO CON LIKES
router.get('/user/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    
    const user = await User.findOne({ username }).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Obtener posts del usuario con populate
    const posts = await Post.find({ author: user._id })
      .populate('author', 'username profilePicture')
      .populate('likes.user', 'username')
      .sort({ createdAt: -1 });

    const postsWithUserInfo = posts.map(post => ({
      id: post._id,
      text: post.text,
      image: post.image, // CORREGIDO: devolver solo la ruta relativa
      author: post.author.username,
      authorProfilePicture: post.author.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${post.author.profilePicture}` : null,
      createdAt: post.createdAt,
      isRichText: post.isRichText,
      likesCount: post.likes.length,
      hasLiked: post.likes.some(like => like.user._id.toString() === req.user.id),
      recentLikes: post.likes.slice(-3).map(like => like.user.username)
    }));

    // Obtener estadísticas de seguidores
    const followersCount = await User.countDocuments({ following: user._id });
    const followingCount = user.following.length;

    // Verificar si el usuario actual sigue a este usuario
    const currentUser = await User.findById(req.user.id);
    const isFollowing = currentUser.following.includes(user._id);

    const profileData = {
      id: user._id,
      username: user.username,
      email: user.email,
      profilePicture: user.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${user.profilePicture}` : null,
      bio: user.bio,
      age: user.age,
      gender: user.gender,
      studies: user.studies,
      createdAt: user.createdAt,
      posts: postsWithUserInfo,
      followersCount,
      followingCount,
      isFollowing,
      canEdit: req.user.id === user._id.toString()
    };

    res.json(profileData);
  } catch (error) {
    console.error('Error fetching profile:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener perfil propio para editar
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('followers', 'username')
      .populate('following', 'username');

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
      createdAt: user.createdAt,
      followersCount: user.followers.length,
      followingCount: user.following.length
    };

    res.json(userData);
  } catch (error) {
    console.error('Error obteniendo perfil propio:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Actualizar perfil
router.put('/me', auth, upload.single('profilePicture'), [
  body('description').optional().isLength({ max: 500 }).withMessage('La descripción no puede exceder 500 caracteres'),
  body('gender').optional().isIn(['masculino', 'femenino', 'otro', 'no especificado']).withMessage('Género no válido'),
  body('age').optional().isInt({ min: 13, max: 120 }).withMessage('La edad debe estar entre 13 y 120 años'),
  body('studies').optional().isLength({ max: 200 }).withMessage('Los estudios no pueden exceder 200 caracteres')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Datos de perfil no válidos',
        errors: errors.array()
      });
    }

    const { description, gender, age, studies } = req.body;
    
    const updateData = {};
    if (description !== undefined) updateData.description = description;
    if (gender !== undefined) updateData.gender = gender;
    if (age !== undefined) updateData.age = age;
    if (studies !== undefined) updateData.studies = studies;
    
    if (req.file) {
      updateData.profilePicture = req.file.filename;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      updateData,
      { new: true }
    ).select('-password');

    const profileData = {
      id: user._id,
      username: user.username,
      email: user.email,
      profilePicture: user.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${user.profilePicture}` : null,
      description: user.description,
      gender: user.gender,
      age: user.age,
      studies: user.studies,
      createdAt: user.createdAt
    };

    res.json({
      message: 'Perfil actualizado exitosamente',
      profile: profileData
    });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Actualizar tema del usuario
router.put('/theme', auth, [
  body('theme').isIn(['light', 'dark', 'red-dark', 'blue-dark', 'green-dark']).withMessage('Tema no válido')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Tema no válido',
        errors: errors.array()
      });
    }

    const { theme } = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { theme },
      { new: true }
    ).select('theme');

    res.json({
      message: 'Tema actualizado exitosamente',
      theme: user.theme
    });
  } catch (error) {
    console.error('Error actualizando tema:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;