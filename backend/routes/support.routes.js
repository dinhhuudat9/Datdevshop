const { createRouter } = require('../lib/nextHttp');
const db = require('../config/database');
const { authenticate } = require('../middleware/auth');
const messageService = require('../services/messageService');

const router = createRouter();

async function getAdminId() {
    const [rows] = await db.execute(
        "SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1"
    );
    return rows.length ? rows[0].id : null;
}

// POST /api/support
router.post('/', authenticate, async (req, res) => {
    try {
        const { type = 'support', subject, content } = req.body;
        const normalizedType = ['support', 'report'].includes(type) ? type : 'support';
        if (!subject || !content) {
            return res.status(400).json({ success: false, message: 'Subject and content are required' });
        }

        const [result] = await db.execute(
            `INSERT INTO support_requests (user_id, type, subject, content)
             VALUES (?, ?, ?, ?)`,
            [req.user.id, normalizedType, subject.trim(), content.trim()]
        );

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/support/my
router.get('/my', authenticate, async (req, res) => {
    try {
        const { type } = req.query;
        const params = [req.user.id];
        let where = 'WHERE user_id = ?';
        if (type) {
            where += ' AND type = ?';
            params.push(type);
        }

        const [rows] = await db.execute(
            `SELECT *
             FROM support_requests
             ${where}
             ORDER BY created_at DESC`,
            params
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/support/thread
router.get('/thread', authenticate, async (req, res) => {
    try {
        const adminId = await getAdminId();
        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const [rows] = await db.execute(
            `SELECT * FROM messages
             WHERE (sender_id = ? AND receiver_id = ?)
                OR (sender_id = ? AND receiver_id = ?)
             ORDER BY created_at ASC`,
            [req.user.id, adminId, adminId, req.user.id]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/support/thread
router.post('/thread', authenticate, async (req, res) => {
    try {
        const adminId = await getAdminId();
        if (!adminId) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const { type = 'support', content } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, message: 'Content is required' });
        }
        const label = type === 'report' ? '[Tố cáo] ' : '[Hỗ trợ] ';
        const message = await messageService.sendMessage(
            req.user.id,
            {
                receiver_id: adminId,
                message_type: 'text',
                content: label + String(content || '').trim()
            },
            {
                ip: req.clientIp || req.ip || req.socket?.remoteAddress || '',
                req,
                recaptchaToken: req.body?.recaptcha_token || '',
                actionType: 'support_message_send'
            }
        );
        res.json({ success: true, data: { id: message?.id || null } });
    } catch (error) {
        if (error.retryAfterSeconds) {
            res.set('Retry-After', String(error.retryAfterSeconds));
        }
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message,
            code: error.code || undefined,
            data: error.data || undefined
        });
    }
});

module.exports = router;
