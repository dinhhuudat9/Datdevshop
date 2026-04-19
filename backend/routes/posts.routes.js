// ============================================
// POSTS ROUTES
// File: backend/routes/posts.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const { authenticate, optionalAuth } = require('../middleware/auth');
const postController = require('../controllers/postController');

router.get('/', optionalAuth, postController.getPosts.bind(postController));
router.get('/:id', optionalAuth, postController.getPostById.bind(postController));
router.get('/:id/comments', optionalAuth, postController.getComments.bind(postController));
router.post('/', authenticate, postController.createPost.bind(postController));
router.post('/:id/like', authenticate, postController.toggleLike.bind(postController));
router.post('/:id/comments', authenticate, postController.addComment.bind(postController));
router.delete('/:id/comments/:commentId', authenticate, postController.deleteComment.bind(postController));
router.delete('/:id', authenticate, postController.deletePost.bind(postController));

module.exports = router;
