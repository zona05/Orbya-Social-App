const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  lastActivity: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Índice compuesto para búsquedas eficientes
conversationSchema.index({ participants: 1 });
conversationSchema.index({ lastActivity: -1 });

// Método para encontrar conversación entre dos usuarios
conversationSchema.statics.findConversation = function(userId1, userId2) {
  return this.findOne({
    participants: { $all: [userId1, userId2] }
  }).populate('participants', 'username profilePicture')
    .populate('lastMessage');
};

module.exports = mongoose.model('Conversation', conversationSchema);