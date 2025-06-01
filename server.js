const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const postRoutes = require('./routes/posts');
const profileRoutes = require('./routes/profiles');
const followRoutes = require('./routes/follows');
const chatRoutes = require('./routes/chat');
const User = require('./models/User');

const app = express();
const server = http.createServer(app);

// Configuración de CORS para producción
const corsOptions = {
  origin: process.env.NODE_ENV === 'production' 
    ? [process.env.FRONTEND_URL || process.env.RAILWAY_STATIC_URL]
    : 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Socket.IO configuración
const io = socketIo(server, {
  cors: corsOptions
});

// Almacenar usuarios conectados
const connectedUsers = new Map();

// Middleware de autenticación para Socket.IO
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    if (!token) {
      return next(new Error('No token provided'));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret_key');
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return next(new Error('Invalid token'));
    }

    socket.userId = user._id.toString();
    socket.username = user.username;
    next();
  } catch (error) {
    next(new Error('Authentication failed'));
  }
});

// Manejo de conexiones de Socket.IO
io.on('connection', (socket) => {
  console.log(`Usuario ${socket.username} conectado a Orbya`);
  
  // Registrar usuario conectado
  connectedUsers.set(socket.userId, {
    socketId: socket.id,
    username: socket.username
  });

  // Unirse a conversaciones
  socket.on('join_conversation', (conversationId) => {
    // Verificar si ya está en la conversación
    const rooms = Array.from(socket.rooms);
    const conversationRoom = `conversation_${conversationId}`;
    
    if (!rooms.includes(conversationRoom)) {
      socket.join(conversationRoom);
      console.log(`${socket.username} se unió a la conversación ${conversationId}`);
    }
  });

  // Salir de conversaciones
  socket.on('leave_conversation', (conversationId) => {
    const conversationRoom = `conversation_${conversationId}`;
    socket.leave(conversationRoom);
    console.log(`${socket.username} salió de la conversación ${conversationId}`);
  });

  // Indicar que está escribiendo
  socket.on('typing', ({ conversationId, isTyping }) => {
    socket.to(`conversation_${conversationId}`).emit('user_typing', {
      username: socket.username,
      isTyping
    });
  });

  // Manejo de desconexión
  socket.on('disconnect', (reason) => {
    console.log(`Usuario ${socket.username} desconectado de Orbya: ${reason}`);
    connectedUsers.delete(socket.userId);
  });

  // Manejo de errores
  socket.on('error', (error) => {
    console.error(`Error en socket de ${socket.username}:`, error);
  });
});

// Hacer io disponible en las rutas
app.set('socketio', io);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos (imágenes subidas)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// En producción, servir archivos del frontend
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'frontend/build')));
}

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/follows', followRoutes);
app.use('/api/chat', chatRoutes);

// En producción, servir el frontend para todas las rutas no-API
if (process.env.NODE_ENV === 'production') {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'frontend/build/index.html'));
  });
}

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Conectado a MongoDB'))
  .catch(err => console.error('❌ Error conectando a MongoDB:', err));

const PORT = process.env.PORT || 5000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`🌍 Modo: ${process.env.NODE_ENV || 'development'}`);
});