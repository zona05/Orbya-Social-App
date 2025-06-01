const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 20
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  profilePicture: {
    type: String,
    default: null
  },
  description: {
    type: String,
    default: 'Sin descripción',
    maxlength: 500
  },
  gender: {
    type: String,
    enum: ['masculino', 'femenino', 'otro', 'no especificado'],
    default: 'no especificado'
  },
  age: {
    type: Number,
    min: 13,
    max: 120,
    default: null
  },
  studies: {
    type: String,
    default: 'No especificado',
    maxlength: 200
  },
  theme: {
    type: String,
    enum: ['light', 'dark', 'red-dark', 'blue-dark', 'green-dark'],
    default: 'light'
  },
  // Nuevos campos para recuperación de contraseña
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  // Campos existentes para seguidores
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, {
  timestamps: true
});

// Hash password antes de guardar
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Método para comparar contraseñas
userSchema.methods.comparePassword = async function(password) {
  return await bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);