// ============================================
// UPLOAD ROUTES
// File: backend/routes/uploads.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const FormData = require('form-data');
const fetch = require('node-fetch');
const { authenticate } = require('../middleware/auth');
const { singleFileUpload } = require('../lib/upload');

const router = createRouter();

const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '26214400', 10);
const allowedMimeTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp'
];

const upload = singleFileUpload({
    fieldName: 'file',
    maxFileSize,
    allowedMimeTypes
});

// POST /api/uploads
router.post('/', authenticate, upload, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
        const apiKey = process.env.IMGBB_API_KEY || '';
        if (!apiKey) {
            return res.status(500).json({ success: false, message: 'Missing IMGBB_API_KEY' });
        }

        const form = new FormData();
        form.append('image', req.file.buffer.toString('base64'));
        form.append('name', req.file.originalname || `upload-${Date.now()}`);

        const response = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });

        const result = await response.json();
        if (!result || !result.success || !result.data) {
            return res.status(400).json({ success: false, message: result?.error?.message || 'Upload failed' });
        }

        const fileUrl = result.data.display_url || result.data.url;

        res.json({
            success: true,
            data: {
                url: fileUrl,
                originalName: req.file.originalname,
                size: req.file.size,
                mimeType: req.file.mimetype
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message || 'Upload failed' });
    }
});

// Error handler for upload
router.use((err, req, res, next) => {
    if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, message: 'File too large' });
        }
        if (err.message === 'File type not allowed') {
            return res.status(400).json({ success: false, message: 'File type not allowed' });
        }
        return res.status(400).json({ success: false, message: err.message || 'Upload error' });
    }
    next();
});

module.exports = router;
