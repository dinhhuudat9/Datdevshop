// ============================================
// POST CONTROLLER
// File: backend/controllers/postController.js
// ============================================

const postService = require('../services/postService');
const notificationService = require('../services/notificationService');

class PostController {
    // GET /api/posts
    async getPosts(req, res) {
        try {
            const userId = req.user ? req.user.id : null;
            const result = await postService.getPosts(req.query, userId);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/posts/:id
    async getPostById(req, res) {
        try {
            const post = await postService.getPostById(req.params.id);
            res.json({ success: true, data: post });
        } catch (error) {
            res.status(404).json({ success: false, message: error.message });
        }
    }

    // POST /api/posts
    async createPost(req, res) {
        try {
            const post = await postService.createPost(req.user.id, req.body);
            if (req.user.role === 'admin') {
                const title = 'Admin đăng bài mới';
                const content = (post.content || '').toString().substring(0, 200);
                await notificationService.createNotification({
                    title,
                    content,
                    created_by: req.user.id
                });
            }
            res.status(201).json({ success: true, message: 'Post created', data: post });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // DELETE /api/posts/:id
    async deletePost(req, res) {
        try {
            await postService.deletePost(req.params.id, req.user.id, req.user.role);
            res.json({ success: true, message: 'Post deleted' });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/posts/:id/like
    async toggleLike(req, res) {
        try {
            const result = await postService.toggleLike(req.params.id, req.user.id);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/posts/:id/comments
    async getComments(req, res) {
        try {
            const comments = await postService.getComments(req.params.id);
            res.json({ success: true, data: comments });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/posts/:id/comments
    async addComment(req, res) {
        try {
            const { content } = req.body;
            const id = await postService.addComment(req.params.id, req.user.id, content, {
                ip: req.clientIp || req.ip || req.socket?.remoteAddress || ''
            });
            res.json({ success: true, data: { id } });
        } catch (error) {
            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }
            res.status(error.statusCode || 400).json({ success: false, message: error.message });
        }
    }

    // DELETE /api/posts/:id/comments/:commentId
    async deleteComment(req, res) {
        try {
            await postService.deleteComment(req.params.id, req.params.commentId, req.user.id, req.user.role);
            res.json({ success: true, message: 'Comment deleted' });
        } catch (error) {
            res.status(error.statusCode || 400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new PostController();
