const express = require('express');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Seguir a un usuario
router.post('/follow/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user._id;

    // Buscar el usuario a seguir
    const userToFollow = await User.findOne({ username });
    if (!userToFollow) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Verificar que no sea el mismo usuario
    if (userToFollow._id.toString() === currentUserId.toString()) {
      return res.status(400).json({ message: 'No puedes seguirte a ti mismo' });
    }

    // Verificar si ya lo sigue
    const currentUser = await User.findById(currentUserId);
    if (currentUser.following.includes(userToFollow._id)) {
      return res.status(400).json({ message: 'Ya sigues a este usuario' });
    }

    // Agregar la relación de seguimiento
    await User.findByIdAndUpdate(currentUserId, {
      $addToSet: { following: userToFollow._id }
    });

    await User.findByIdAndUpdate(userToFollow._id, {
      $addToSet: { followers: currentUserId }
    });

    res.json({ 
      message: 'Usuario seguido exitosamente',
      isFollowing: true
    });
  } catch (error) {
    console.error('Error siguiendo usuario:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Dejar de seguir a un usuario
router.delete('/unfollow/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user._id;

    // Buscar el usuario a dejar de seguir
    const userToUnfollow = await User.findOne({ username });
    if (!userToUnfollow) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    // Remover la relación de seguimiento
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { following: userToUnfollow._id }
    });

    await User.findByIdAndUpdate(userToUnfollow._id, {
      $pull: { followers: currentUserId }
    });

    res.json({ 
      message: 'Dejaste de seguir al usuario',
      isFollowing: false
    });
  } catch (error) {
    console.error('Error dejando de seguir usuario:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener estado de seguimiento
router.get('/status/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user._id;

    const userToCheck = await User.findOne({ username });
    if (!userToCheck) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const currentUser = await User.findById(currentUserId);
    const isFollowing = currentUser.following.includes(userToCheck._id);

    res.json({ isFollowing });
  } catch (error) {
    console.error('Error verificando estado de seguimiento:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener seguidores de un usuario
router.get('/followers/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username })
      .populate('followers', 'username profilePicture')
      .select('followers');

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const followers = user.followers.map(follower => ({
      id: follower._id,
      username: follower.username,
      profilePicture: follower.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${follower.profilePicture}` : null
    }));

    res.json(followers);
  } catch (error) {
    console.error('Error obteniendo seguidores:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

// Obtener usuarios seguidos
router.get('/following/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    const user = await User.findOne({ username })
      .populate('following', 'username profilePicture')
      .select('following');

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    const following = user.following.map(followed => ({
      id: followed._id,
      username: followed.username,
      profilePicture: followed.profilePicture ? 
        `${req.protocol}://${req.get('host')}/uploads/profiles/${followed.profilePicture}` : null
    }));

    res.json(following);
  } catch (error) {
    console.error('Error obteniendo seguidos:', error);
    res.status(500).json({ message: 'Error del servidor' });
  }
});

module.exports = router;