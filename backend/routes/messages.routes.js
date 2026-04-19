// ============================================
// MESSAGES ROUTES
// File: backend/routes/messages.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const { authenticate } = require('../middleware/auth');
const messageController = require('../controllers/messageController');

router.get('/conversations', authenticate, messageController.getConversations.bind(messageController));
router.get('/:userId', authenticate, messageController.getMessages.bind(messageController));
router.post('/', authenticate, messageController.sendMessage.bind(messageController));
router.delete('/:id', authenticate, messageController.deleteMessage.bind(messageController));

module.exports = router;
