const express = require('express');
const bcryptjs = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

// Connexion à MongoDB
require('./db/connection');

// Import modèles
const Users = require('./models/Users');
const Conversations = require('./models/Conversations');
const Messages = require('./models/Messages');

// Initialisation app et serveur
const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 8000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Socket.io sur le même serveur
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:3000',
  }
});

// 🔌 Gestion des sockets
let users = [];

io.on('connection', socket => {
  console.log('✅ Socket connecté :', socket.id);

  socket.on('addUser', userId => {
    if (!users.find(user => user.userId === userId)) {
      users.push({ userId, socketId: socket.id });
    }
    io.emit('getUsers', users);
  });

  socket.on('sendMessage', async ({ senderId, receiverId, message, conversationId }) => {
    const receiver = users.find(user => user.userId === receiverId);
    const sender = users.find(user => user.userId === senderId);
    const user = await Users.findById(senderId);

    const payload = {
      senderId,
      message,
      conversationId,
      receiverId,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email
      }
    };

    if (receiver) {
      io.to(receiver.socketId).to(sender.socketId).emit('getMessage', payload);
    } else {
      io.to(sender.socketId).emit('getMessage', payload);
    }
  });

  socket.on('disconnect', () => {
    users = users.filter(u => u.socketId !== socket.id);
    io.emit('getUsers', users);
  });
});

// 🌐 Routes Express
app.get('/', (req, res) => {
  res.send('Welcome to the chat API!');
});

app.post('/api/register', async (req, res) => {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).send('Please fill all required fields');
    }

    const isAlreadyExist = await Users.findOne({ email });
    if (isAlreadyExist) {
      return res.status(400).send('User already exists');
    }

    const hashedPassword = await bcryptjs.hash(password, 10);
    const newUser = new Users({ fullName, email, password: hashedPassword });
    await newUser.save();

    return res.status(200).json({ message: 'User registered successfully' });
} catch (error) {
    console.error(error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Please fill all required fields');
    }

    const user = await Users.findOne({ email });
    if (!user) {
      return res.status(400).send('User email or password is incorrect');
    }

    const validateUser = await bcryptjs.compare(password, user.password);
    if (!validateUser) {
      return res.status(400).send('User email or password is incorrect');
    }

    const payload = {
      userId: user._id,
      email: user.email
    };
    const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || 'THIS_IS_A_JWT_SECRET_KEY';

    jwt.sign(payload, JWT_SECRET_KEY, { expiresIn: 84600 }, async (err, token) => {
      if (err) throw err;
      await Users.updateOne({ _id: user._id }, { $set: { token } });
      return res.status(200).json({
        user: { id: user._id, email: user.email, fullName: user.fullName },
        token
      });
    });
  } catch (error) {
    console.log(error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/conversation', async (req, res) => {
  try {
    const { senderId, receiverId } = req.body;
    const newConversation = new Conversations({ members: [senderId, receiverId] });
    await newConversation.save();
    res.status(200).send('Conversation created successfully');
  } catch (error) {
    console.log(error);
    res.status(500).send('Error creating conversation');
  }
});

app.get('/api/conversations/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const conversations = await Conversations.find({ members: { $in: [userId] } });
    const conversationUserData = await Promise.all(conversations.map(async (conversation) => {
      const receiverId = conversation.members.find(member => member !== userId);
      const user = await Users.findById(receiverId);
      return {
        user: {
          receiverId: user._id,
          email: user.email,
          fullName: user.fullName
        },
        conversationId: conversation._id
      };
    }));
    res.status(200).json(conversationUserData);
  } catch (error) {
    console.log(error);
    res.status(500).send('Error getting conversations');
  }
});

app.post('/api/message', async (req, res) => {
  try {
    const { conversationId, senderId, message, receiverId = '' } = req.body;
    if (!senderId || !message) return res.status(400).send('Please fill all required fields');

    if (conversationId === 'new' && receiverId) {
      const newConversation = new Conversations({ members: [senderId, receiverId] });
      await newConversation.save();
      const newMessage = new Messages({ conversationId: newConversation._id, senderId, message });
      await newMessage.save();
      return res.status(200).send('Message sent successfully');
    }

    if (!conversationId && !receiverId) {
      return res.status(400).send('Please fill all required fields');
    }

    const newMessage = new Messages({ conversationId, senderId, message });
    await newMessage.save();
    res.status(200).send('Message sent successfully');
  } catch (error) {
    console.log(error);
    res.status(500).send('Error sending message');
  }
});

app.get('/api/message/:conversationId', async (req, res) => {
  try {
    const conversationId = req.params.conversationId;

    const checkMessages = async (id) => {
      const messages = await Messages.find({ conversationId: id });
      const messageUserData = await Promise.all(messages.map(async (message) => {
        const user = await Users.findById(message.senderId);
        return {
          user: { id: user._id, email: user.email, fullName: user.fullName },
          message: message.message
        };
      }));
      res.status(200).json(messageUserData);
    }

    if (conversationId === 'new') {
      const { senderId, receiverId } = req.query;
      const conversation = await Conversations.findOne({ members: { $all: [senderId, receiverId] } });
      if (conversation) {
        await checkMessages(conversation._id);
      } else {
        return res.status(200).json([]);
      }
    } else {
      await checkMessages(conversationId);
    }
  } catch (error) {
    console.log('Error', error);
    res.status(500).send('Error getting messages');
  }
});

app.get('/api/users/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const users = await Users.find({ _id: { $ne: userId } });
    const usersData = users.map(user => ({
      user: {
        email: user.email,
        fullName: user.fullName,
        receiverId: user._id
      }
    }));
    res.status(200).json(usersData);
  } catch (error) {
    console.log('Error', error);
    res.status(500).send('Error getting users');
  }
});

// 🚀 Démarrage serveur
server.listen(port, () => {
  console.log(`🚀 Server (Express + Socket.IO) running on http://localhost:${port}`);
});
