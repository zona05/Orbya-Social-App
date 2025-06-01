const mongoose = require('mongoose');

const postSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    maxlength: 5000
  },
  isRichText: {
    type: Boolean,
    default: false
  },
  image: {
    type: String,
    default: null
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  likes: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  likesCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Índices para consultas eficientes
postSchema.index({ author: 1, createdAt: -1 });
postSchema.index({ 'likes.user': 1 });
postSchema.index({ likesCount: -1 });
postSchema.index({ createdAt: -1 });

// Índice compuesto para evitar likes duplicados
postSchema.index({ _id: 1, 'likes.user': 1 }, { unique: true, sparse: true });

// Middleware para actualizar likesCount automáticamente
postSchema.pre('save', function(next) {
  if (this.isModified('likes')) {
    this.likesCount = this.likes.length;
  }
  next();
});

// Método para verificar si un usuario ha dado like - MEJORADO
postSchema.methods.hasUserLiked = function(userId) {
  if (!userId) return false;
  const userIdStr = userId.toString();
  return this.likes.some(like => like.user.toString() === userIdStr);
};

// Método para añadir like - MEJORADO
postSchema.methods.addLike = function(userId) {
  if (!userId) return false;
  
  const userIdStr = userId.toString();
  
  // Verificar si ya existe el like
  const existingLike = this.likes.find(like => 
    like.user.toString() === userIdStr
  );
  
  if (existingLike) {
    console.log(`Usuario ${userIdStr} ya ha dado like a este post`);
    return false;
  }
  
  // Añadir el like
  this.likes.push({ user: userId });
  console.log(`Like añadido por usuario ${userIdStr}. Total likes: ${this.likes.length}`);
  return true;
};

// Método para quitar like - MEJORADO
postSchema.methods.removeLike = function(userId) {
  if (!userId) return false;
  
  const userIdStr = userId.toString();
  const initialLength = this.likes.length;
  
  // Filtrar el like del usuario
  this.likes = this.likes.filter(like => 
    like.user.toString() !== userIdStr
  );
  
  const removed = this.likes.length < initialLength;
  if (removed) {
    console.log(`Like removido por usuario ${userIdStr}. Total likes: ${this.likes.length}`);
  } else {
    console.log(`No se encontró like del usuario ${userIdStr} para remover`);
  }
  
  return removed;
};

module.exports = mongoose.model('Post', postSchema);