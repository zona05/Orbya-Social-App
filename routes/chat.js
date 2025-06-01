const express = require('express');
const multer = require('multer');
const path = require('path');
const { body, validationResult } = require('express-validator');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Configuración de multer para imágenes de chat
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/chat/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
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

// Verificar seguimiento mutuo
const checkMutualFollow = async (userId1, userId2) => {
  const user1 = await User.findById(userId1);
  const user2 = await User.findById(userId2);
  
  if (!user1 || !user2) return false;
  
  const user1FollowsUser2 = user1.following.includes(userId2);
  const user2FollowsUser1 = user2.following.includes(userId1);
  
  return user1FollowsUser2 && user2FollowsUser1;
};

// Verificar si se puede chatear con un usuario
router.get('/can-chat/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user._id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    if (targetUser._id.toString() === currentUserId.toString()) {
      return res.json({ canChat: false, reason: 'No puedes chatear contigo mismo' });
    }

    const canChat = await checkMutualFollow(currentUserId, targetUser._id);
    
    res.json({ 
      canChat,
      reason: canChat ? null : 'Deben seguirse mutuamente para poder chatear'
    });
  } catch (error) {
    console.error('Error verificando capacidad de chat:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener o crear conversación
router.post('/conversation/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user._id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar seguimiento mutuo
    const canChat = await checkMutualFollow(currentUserId, targetUser._id);
    if (!canChat) {
      return res.status(403).json({ message: 'No pueden chatear. Deben seguirse mutuamente.' });
    }

    // Buscar conversación existente
    let conversation = await Conversation.findConversation(currentUserId, targetUser._id);

    // Si no existe, crear nueva conversación
    if (!conversation) {
      conversation = new Conversation({
        participants: [currentUserId, targetUser._id]
      });
      await conversation.save();
      await conversation.populate('participants', 'username profilePicture');
    }

    res.json({
      conversationId: conversation._id,
      participants: conversation.participants.map(p => ({
        id: p._id,
        username: p.username,
        profilePicture: p.profilePicture ? 
          `${req.protocol}://${req.get('host')}/uploads/profiles/${p.profilePicture}` : null
      }))
    });
  } catch (error) {
    console.error('Error obteniendo/creando conversación:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener mensajes de una conversación
router.get('/conversation/:conversationId/messages', auth, async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const currentUserId = req.user._id;

    // Verificar que el usuario es participante de la conversación
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ message: 'No tienes acceso a esta conversación' });
    }

    const messages = await Message.find({ 
      conversation: conversationId,
      isDeleted: false
    })
    .populate('sender', 'username profilePicture')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const formattedMessages = messages.reverse().map(message => ({
      id: message._id,
      content: message.content,
      image: message.image ? `${req.protocol}://${req.get('host')}/uploads/chat/${message.image}` : null,
      messageType: message.messageType,
      sender: {
        id: message.sender._id,
        username: message.sender.username,
        profilePicture: message.sender.profilePicture ? 
          `${req.protocol}://${req.get('host')}/uploads/profiles/${message.sender.profilePicture}` : null
      },
      createdAt: message.createdAt,
      isOwn: message.sender._id.toString() === currentUserId.toString()
    }));

    res.json(formattedMessages);
  } catch (error) {
    console.error('Error obteniendo mensajes:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Enviar mensaje
router.post('/message', auth, upload.single('image'), [
  body('conversationId').notEmpty().withMessage('ID de conversación requerido'),
  body('content').optional().isLength({ max: 1000 }).withMessage('Mensaje muy largo')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        message: 'Datos de entrada no válidos',
        errors: errors.array()
      });
    }

    const { conversationId, content } = req.body;
    const currentUserId = req.user._id;
    const image = req.file ? req.file.filename : null;

    // Validar que hay contenido o imagen
    if (!content && !image) {
      return res.status(400).json({ message: 'Debe proporcionar contenido o imagen' });
    }

    // Verificar que el usuario es participante de la conversación
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(currentUserId)) {
      return res.status(403).json({ message: 'No tienes acceso a esta conversación' });
    }

    // Verificar seguimiento mutuo (por seguridad)
    const otherParticipant = conversation.participants.find(p => p.toString() !== currentUserId.toString());
    const canChat = await checkMutualFollow(currentUserId, otherParticipant);
    if (!canChat) {
      return res.status(403).json({ message: 'Ya no pueden chatear. Verificar seguimiento mutuo.' });
    }

    // Crear mensaje
    const message = new Message({
      conversation: conversationId,
      sender: currentUserId,
      content: content || '',
      image,
      messageType: image ? 'image' : 'text'
    });

    await message.save();
    await message.populate('sender', 'username profilePicture');

    // Actualizar conversación
    await Conversation.findByIdAndUpdate(conversationId, {
      lastMessage: message._id,
      lastActivity: new Date()
    });

    const formattedMessage = {
      id: message._id,
      content: message.content,
      image: message.image ? `${req.protocol}://${req.get('host')}/uploads/chat/${message.image}` : null,
      messageType: message.messageType,
      sender: {
        id: message.sender._id,
        username: message.sender.username,
        profilePicture: message.sender.profilePicture ? 
          `${req.protocol}://${req.get('host')}/uploads/profiles/${message.sender.profilePicture}` : null
      },
      createdAt: message.createdAt,
      isOwn: true
    };

    // Emitir evento de socket si está disponible
    if (req.app.get('socketio')) {
      req.app.get('socketio').to(`conversation_${conversationId}`).emit('new_message', formattedMessage);
    }

    res.status(201).json(formattedMessage);
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Eliminar mensaje
router.delete('/message/:messageId', auth, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: 'Mensaje no encontrado' });
    }

    if (message.sender.toString() !== currentUserId.toString()) {
      return res.status(403).json({ message: 'Solo puedes eliminar tus propios mensajes' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    await message.save();

    // Emitir evento de socket
    if (req.app.get('socketio')) {
      req.app.get('socketio').to(`conversation_${message.conversation}`).emit('message_deleted', {
        messageId: message._id
      });
    }

    res.json({ message: 'Mensaje eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando mensaje:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener lista de conversaciones del usuario
router.get('/conversations', auth, async (req, res) => {
  try {
    const currentUserId = req.user._id;

    const conversations = await Conversation.find({
      participants: currentUserId
    })
    .populate('participants', 'username profilePicture')
    .populate('lastMessage')
    .sort({ lastActivity: -1 });

    const formattedConversations = conversations.map(conv => {
      const otherParticipant = conv.participants.find(p => p._id.toString() !== currentUserId.toString());
      
      return {
        id: conv._id,
        participant: {
          id: otherParticipant._id,
          username: otherParticipant.username,
          profilePicture: otherParticipant.profilePicture ? 
            `${req.protocol}://${req.get('host')}/uploads/profiles/${otherParticipant.profilePicture}` : null
        },
        lastMessage: conv.lastMessage ? {
          content: conv.lastMessage.content,
          messageType: conv.lastMessage.messageType,
          createdAt: conv.lastMessage.createdAt
        } : null,
        lastActivity: conv.lastActivity
      };
    });

    res.json(formattedConversations);
  } catch (error) {
    console.error('Error obteniendo conversaciones:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;