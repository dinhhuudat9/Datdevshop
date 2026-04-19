// ============================================
// USER CONTROLLER
// File: backend/controllers/userController.js
// ============================================

const userService = require('../services/userService');
const path = require('path');
const fs = require('fs');

const FRAMES_DIR = path.join(__dirname, '../../khungcanhan');

class UserController {
    // GET /api/users/search
    async searchUsers(req, res) {
        try {
            const result = await userService.searchUsers(req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/users/:id
    async getProfile(req, res) {
        try {
            const user = await userService.getProfile(req.params.id);
            res.json({ success: true, data: user });
        } catch (error) {
            res.status(404).json({ success: false, message: error.message });
        }
    }

    // GET /api/users/frames/list
    async listFrames(req, res) {
        try {
            if (!fs.existsSync(FRAMES_DIR)) {
                return res.json({ success: true, data: [] });
            }
            const files = fs.readdirSync(FRAMES_DIR)
                .filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f))
                .map(f => ({
                    name: f,
                    url: `/frames/${f}`
                }));
            res.json({ success: true, data: files });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    }

    // PUT /api/users/me/frame
    async updateFrame(req, res) {
        try {
            const { frame_url } = req.body;
            let finalUrl = '';
            if (frame_url) {
                const filename = path.basename(frame_url);
                const filepath = path.join(FRAMES_DIR, filename);
                if (!fs.existsSync(filepath)) {
                    return res.status(400).json({ success: false, message: 'Khung không tồn tại' });
                }
                finalUrl = `/frames/${filename}`;
            }

            const updated = await userService.updateFrame(req.user.id, finalUrl);
            res.json({ success: true, data: updated });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new UserController();
