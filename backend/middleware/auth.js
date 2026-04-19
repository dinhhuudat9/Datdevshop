// ============================================
// AUTHENTICATION MIDDLEWARE
// File: backend/middleware/auth.js
// ============================================

const jwt = require('jsonwebtoken');
const db = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Verify JWT token
async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized - No token provided'
            });
        }
        
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Get user from database
        const [users] = await db.execute(
            'SELECT id, email, full_name, avatar, role, status, balance FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length === 0) {
            return res.status(401).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Check if user is banned
        if (user.status === 'banned') {
            return res.status(403).json({
                success: false,
                message: 'Account has been banned'
            });
        }

        // Attach user to request
        req.user = user;
        next();

    } catch (error) {
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token expired'
            });
        }
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token'
            });
        }

        console.error('Auth middleware error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
}

// Check role
function authorize(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                message: 'Forbidden - Insufficient permissions'
            });
        }

        next();
    };
}

// Optional authentication (không bắt buộc đăng nhập)
async function optionalAuth(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        let token = null;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        if (!token) {
            return next();
        }
        const decoded = jwt.verify(token, JWT_SECRET);
        
        const [users] = await db.execute(
            'SELECT id, email, full_name, avatar, role, status, balance FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (users.length > 0 && users[0].status === 'active') {
            req.user = users[0];
        }

        next();
    } catch (error) {
        next();
    }
}

module.exports = { authenticate, authorize, optionalAuth, JWT_SECRET };
