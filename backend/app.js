// ============================================
// API APP
// File: backend/app.js
// ============================================

const { createApp, cors, cookieParser, json, urlencoded } = require('./lib/nextHttp');
require('dotenv').config();
const logService = require('./services/logService');
const { ipGuard } = require('./middleware/ipGuard');
const humanGateService = require('./services/humanGateService');

const app = createApp();

function parseTrustProxy(value) {
    if (value === undefined || value === null || value === '') {
        return false;
    }

    if (typeof value === 'number') {
        return value;
    }

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) {
        return false;
    }

    if (['true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
        return numeric;
    }

    return value;
}

const trustProxyOverride = process.env.TRUST_PROXY;
const defaultTrustProxy = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
app.set(
    'trust proxy',
    trustProxyOverride === undefined ? defaultTrustProxy : parseTrustProxy(trustProxyOverride)
);

const DEFAULT_ALLOWED = [
    'http://localhost:3000',
    'http://localhost:4173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:4173',
    'https://sangdev.onrender.com',
    'https://shopbanmanguon.duongthithuyhangkupee.workers.dev',
    'https://sangdev.duongthithuyhangkupee.workers.dev'
];
const envAllowed = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
const DEFAULT_SUFFIXES = ['.workers.dev'];
const envSuffixes = (process.env.CORS_ORIGIN_SUFFIXES || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
const allowedOrigins = [...DEFAULT_ALLOWED, ...envAllowed];

function normalizeOrigin(origin = '') {
    try {
        const parsed = new URL(origin);
        return `${parsed.protocol}//${parsed.host}`.toLowerCase();
    } catch (_) {
        return '';
    }
}

function getRequestOrigin(req) {
    const forwardedProto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http')
        .split(',')[0]
        .trim()
        .toLowerCase();
    const forwardedHost = String(req.headers['x-forwarded-host'] || req.headers.host || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    if (!forwardedHost) {
        return '';
    }

    return `${forwardedProto}://${forwardedHost}`;
}

function isAllowedOrigin(req, origin = '') {
    if (!origin) {
        return true;
    }

    if (allowedOrigins.includes(origin)) {
        return true;
    }

    const normalizedOrigin = normalizeOrigin(origin);
    const requestOrigin = getRequestOrigin(req);
    if (normalizedOrigin && requestOrigin && normalizedOrigin === requestOrigin) {
        return true;
    }

    try {
        const hostname = new URL(origin).hostname.toLowerCase();
        return [...DEFAULT_SUFFIXES, ...envSuffixes].some(suffix => {
            const clean = suffix.replace(/^\./, '');
            return hostname === clean || hostname.endsWith(`.${clean}`);
        });
    } catch (_) {
        return false;
    }
}

// ANSI colors for pretty logs (no extra deps)
const COLORS = {
    reset: '\x1b[0m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m'
};
const colorByStatus = (status) => {
    if (status >= 500) return COLORS.red;
    if (status >= 400) return COLORS.yellow;
    return COLORS.green;
};

// ============================================
// MIDDLEWARE
// ============================================
app.use(cors((req, cb) => {
    const origin = String(req.headers.origin || '').trim();
    if (!origin || isAllowedOrigin(req, origin)) {
        return cb(null, {
            origin: true,
            credentials: true
        });
    }

    return cb(new Error(`Not allowed by CORS: ${origin}`), {
        origin: false,
        credentials: true
    });
}));
app.use(cookieParser());
app.use(json());
app.use(urlencoded({ extended: true }));
app.use(ipGuard);

// Logging middleware (color + response time)
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const ms = Date.now() - start;
        const status = res.statusCode;
        const method = `${COLORS.cyan}${req.method.padEnd(6)}${COLORS.reset}`;
        const line = `${method} ${req.originalUrl} ${colorByStatus(status)}${status}${COLORS.reset} ${COLORS.dim}${ms}ms${COLORS.reset}`;
        console.log(line);
        logService.recordRequest({
            method: req.method,
            path: req.originalUrl,
            status,
            durationMs: ms,
            userId: req.user?.id || null,
            email: req.user?.email || null,
            ip: req.clientIp || req.ip || req.socket?.remoteAddress || ''
        });
    });
    next();
});

function isHumanGateExemptApiPath(pathname = '') {
    const value = String(pathname || '').trim();
    return (
        value === '/health' ||
        value.startsWith('/integration/') ||
        value === '/security/human-gate-config' ||
        value === '/security/human-gate-verify'
    );
}

app.use('/api', (req, res, next) => {
    if (req.method === 'OPTIONS' || isHumanGateExemptApiPath(req.path)) {
        return next();
    }

    if (humanGateService.hasClearance(req)) {
        return next();
    }

    return res.status(403).json({
        success: false,
        code: 'HUMAN_GATE_REQUIRED',
        message: 'Vui long xac nhan ban la nguoi that truoc khi vao website.'
    });
});

// ============================================
// API ROUTES
// ============================================
const authRoutes = require('./routes/auth.routes');
const productRoutes = require('./routes/products.routes');
const categoryRoutes = require('./routes/categories.routes');
const userRoutes = require('./routes/users.routes');
const walletRoutes = require('./routes/wallet.routes');
const postRoutes = require('./routes/posts.routes');
const messageRoutes = require('./routes/messages.routes');
const adminRoutes = require('./routes/admin.routes');
const uploadRoutes = require('./routes/uploads.routes');
const settingsRoutes = require('./routes/settings.routes');
const supportRoutes = require('./routes/support.routes');
const communityRoutes = require('./routes/community.routes');
const notificationRoutes = require('./routes/notifications.routes');
const integrationRoutes = require('./routes/integration.routes');
const aiRoutes = require('./routes/ai.routes');
const protectedAssetRoutes = require('./routes/protectedAssets.routes');
const securityRoutes = require('./routes/security.routes');

app.use('/api/auth', authRoutes);
app.use('/api/assets', protectedAssetRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/users', userRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/community', communityRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/integration', integrationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/security', securityRoutes);

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// ============================================
// ERROR HANDLER
// ============================================
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal Server Error'
    });
});

module.exports = app;
