const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const Post = require('../models/Post');
const auth = require('../middleware/auth');

const router = express.Router();

// Configuración de multer para subida de imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
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

// Función para sanitizar HTML en el servidor
const sanitizeHTML = (html) => {
  // Lista de tags permitidos
  const allowedTags = [
    'h1', 'h2', 'h3', 'p', 'br', 'strong', 'b', 'em', 'i', 
    'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'hr'
  ];
  
  // Función básica de sanitización usando regex
  let sanitized = html;
  
  // Remover tags script y style completamente
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  sanitized = sanitized.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remover atributos peligrosos
  sanitized = sanitized.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/\s*javascript\s*:/gi, '');
  
  return sanitized;
};

// Obtener todos los posts (feed global) - CORREGIDO
router.get('/', auth, async (req, res) => {
  try {
    const posts = await Post.find()
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

    res.json(postsWithUserInfo);
  } catch (error) {
    console.error('Error fetching posts:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Crear nuevo post
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { text, isRichText } = req.body;
    
    if (!text || text.trim() === '') {
      return res.status(400).json({ message: 'El contenido es requerido' });
    }

    const postData = {
      text: text.trim(),
      author: req.user.id,
      isRichText: isRichText === 'true'
    };

    if (req.file) {
      postData.image = `/uploads/${req.file.filename}`;
    }

    const post = new Post(postData);
    await post.save();

    // Hacer populate para obtener la información del usuario
    await post.populate('author', 'username profilePicture');

    const postResponse = {
      id: post._id,
      text: post.text,
      image: post.image, // CORREGIDO: devolver solo la ruta relativa
      author: post.author.username,
      authorProfilePicture: post.author.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${post.author.profilePicture}` : null,
      createdAt: post.createdAt,
      isRichText: post.isRichText,
      likesCount: 0,
      hasLiked: false,
      recentLikes: []
    };

    // Emitir el nuevo post via Socket.IO
    const io = req.app.get('socketio');
    io.emit('new_post', postResponse);

    res.status(201).json({ post: postResponse });
  } catch (error) {
    console.error('Error creating post:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// DAR LIKE A UN POST - CORREGIDO
router.post('/:id/like', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    // CORREGIDO: Verificación más estricta de likes existentes
    const hasAlreadyLiked = post.hasUserLiked(userId);
    if (hasAlreadyLiked) {
      return res.status(400).json({ message: 'Ya has dado like a este post' });
    }

    // Añadir like y guardar
    const likeAdded = post.addLike(userId);
    if (!likeAdded) {
      return res.status(400).json({ message: 'No se pudo añadir el like' });
    }

    await post.save();

    // Recargar el post con los datos actualizados
    await post.populate([
      { path: 'author', select: 'username' },
      { path: 'likes.user', select: 'username' }
    ]);

    const likeData = {
      postId: post._id,
      likesCount: post.likesCount,
      hasLiked: true,
      recentLikes: post.likes
        .slice(-3)
        .map(like => like.user.username)
        .reverse(),
      likedBy: req.user.username
    };

    // Emitir evento de socket para actualización en tiempo real
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('post_liked', likeData);
    }

    res.json({
      message: 'Like añadido exitosamente',
      ...likeData
    });

  } catch (error) {
    console.error('Error añadiendo like:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// QUITAR LIKE DE UN POST - CORREGIDO
router.delete('/:id/like', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user._id;

    const post = await Post.findById(postId);

    if (!post) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    // CORREGIDO: Verificar si tiene like antes de quitar
    const hasLiked = post.hasUserLiked(userId);
    if (!hasLiked) {
      return res.status(400).json({ message: 'No has dado like a este post' });
    }

    // Quitar like y guardar
    const likeRemoved = post.removeLike(userId);
    if (!likeRemoved) {
      return res.status(400).json({ message: 'No se pudo quitar el like' });
    }

    await post.save();

    // Recargar el post con los datos actualizados
    await post.populate([
      { path: 'author', select: 'username' },
      { path: 'likes.user', select: 'username' }
    ]);

    const likeData = {
      postId: post._id,
      likesCount: post.likesCount,
      hasLiked: false,
      recentLikes: post.likes
        .slice(-3)
        .map(like => like.user.username)
        .reverse(),
      unlikedBy: req.user.username
    };

    // Emitir evento de socket para actualización en tiempo real
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('post_unliked', likeData);
    }

    res.json({
      message: 'Like removido exitosamente',
      ...likeData
    });

  } catch (error) {
    console.error('Error removiendo like:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// OBTENER USUARIOS QUE HAN DADO LIKE A UN POST
router.get('/:id/likes', auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const { page = 1, limit = 20 } = req.query;

    const post = await Post.findById(postId)
      .populate({
        path: 'likes.user',
        select: 'username profilePicture'
      });

    if (!post) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    // Aplicar paginación manualmente
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedLikes = post.likes
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(startIndex, endIndex);

    const likesData = paginatedLikes.map(like => ({
      user: {
        id: like.user._id,
        username: like.user.username,
        profilePicture: like.user.profilePicture ? 
          `${req.protocol}://${req.get('host')}/uploads/profiles/${like.user.profilePicture}` : null
      },
      likedAt: like.createdAt
    }));

    res.json({
      likes: likesData,
      totalLikes: post.likesCount,
      currentPage: parseInt(page),
      hasMore: endIndex < post.likes.length
    });

  } catch (error) {
    console.error('Error obteniendo likes:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Eliminar post (solo el autor puede eliminar su propio post)
router.delete('/:id', auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    
    if (!post) {
      return res.status(404).json({ message: 'Post no encontrado' });
    }

    if (post.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'No tienes permiso para eliminar este post' });
    }

    await Post.findByIdAndDelete(req.params.id);

    // Emitir evento de socket para actualización en tiempo real
    if (req.app.get('socketio')) {
      req.app.get('socketio').emit('post_deleted', { postId: req.params.id });
    }

    res.json({ message: 'Post eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando post:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

const handlePostLiked = (likeData) => {
  setPosts(prevPosts => 
    prevPosts.map(post => 
      post.id === likeData.postId 
        ? {
            ...post,
            likesCount: likeData.likesCount,
            hasLiked: likeData.likedBy === currentUser?.username ? true : post.hasLiked,
            recentLikes: likeData.recentLikes
          }
        : post
    )
  );
};

const handlePostUnliked = (likeData) => {
  setPosts(prevPosts => 
    prevPosts.map(post => 
      post.id === likeData.postId 
        ? {
            ...post,
            likesCount: likeData.likesCount,
            hasLiked: likeData.unlikedBy === currentUser?.username ? false : post.hasLiked,
            recentLikes: likeData.recentLikes
          }
        : post
    )
  );
};

module.exports = router;