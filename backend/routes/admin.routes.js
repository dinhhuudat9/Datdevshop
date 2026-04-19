// ============================================
// ADMIN ROUTES
// File: backend/routes/admin.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const { authenticate, authorize } = require('../middleware/auth');
const db = require('../config/database');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { singleFileUpload } = require('../lib/upload');
const notificationService = require('../services/notificationService');
const { exportAll, queueFullBackup } = require('../services/telegramBackupService');
const { getArchive } = require('../services/archiveService');
const logService = require('../services/logService');
const messageService = require('../services/messageService');
const loginProtectionService = require('../services/loginProtectionService');
const {
    normalizeIp,
    blockIpTemporarily,
    clearIpBlockState,
    isProtectedIp,
    MANUAL_ADMIN_BLOCK_REASON
} = require('../middleware/ipGuard');
const {
    SHARED_IP_SECURITY_LOCK_REASON,
    clearSecurityLockForUser,
    unlockAccountsByIp
} = require('../services/ipAccountSecurityService');
const PRIMARY_ADMIN_EMAIL = process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com';
const FRAMES_DIR = path.join(__dirname, '../../khungcanhan');
const FRAME_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const frameMaxFileSize = parseInt(process.env.MAX_FILE_SIZE || '26214400', 10);
const MANUAL_ADMIN_BLOCK_MS = parseInt(process.env.ADMIN_MANUAL_IP_BLOCK_MS || '315360000000', 10);
const slugify = (text = '') => text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();

async function getDatabaseSizeBytes() {
    try {
        const [pageSizeRows] = await db.execute('PRAGMA page_size');
        const [pageCountRows] = await db.execute('PRAGMA page_count');
        const pageSize = Number(pageSizeRows[0]?.page_size || 0);
        const pageCount = Number(pageCountRows[0]?.page_count || 0);
        return pageSize * pageCount;
    } catch (error) {
        return 0;
    }
}

function getSystemStats() {
    const totalBytes = os.totalmem();
    const freeBytes = os.freemem();
    const usedBytes = Math.max(totalBytes - freeBytes, 0);
    const cpus = os.cpus() || [];
    const load = os.loadavg();

    return {
        memory: {
            totalBytes,
            freeBytes,
            usedBytes,
            usedPercent: totalBytes ? Number(((usedBytes / totalBytes) * 100).toFixed(1)) : 0
        },
        cpu: {
            model: cpus[0]?.model || 'Unknown',
            cores: cpus.length || 0,
            speedMhz: cpus[0]?.speed || 0
        },
        load: {
            '1m': load?.[0] || 0,
            '5m': load?.[1] || 0,
            '15m': load?.[2] || 0
        },
        uptimeSec: os.uptime()
    };
}

async function getTableStats() {
    try {
        const [tableRows] = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        );
        const results = [];
        for (const row of tableRows) {
            const tableName = row.name;
            if (!tableName) continue;
            const [countRows] = await db.execute(`SELECT COUNT(*) as rows FROM ${tableName}`);
            results.push({
                name: tableName,
                rows: countRows[0]?.rows || 0,
                bytes: 0
            });
        }
        return results;
    } catch (error) {
        return [];
    }
}

async function getUserById(userId) {
    const [rows] = await db.execute(
        'SELECT id, email, role FROM users WHERE id = ?',
        [userId]
    );
    return rows[0] || null;
}

async function getUserUnlockContext(userId) {
    const [rows] = await db.execute(
        `SELECT id, email, last_login_ip, last_failed_login_ip, security_locked_ip
         FROM users
         WHERE id = ?`,
        [userId]
    );
    return rows[0] || null;
}

function isPrimaryAdmin(user) {
    return !!user && user.email === PRIMARY_ADMIN_EMAIL;
}

function isRequestFromPrimary(req) {
    return req.user && req.user.email === PRIMARY_ADMIN_EMAIL;
}

async function verifyAdminPassword(adminId, password) {
    if (!password) return false;
    const [rows] = await db.execute(
        'SELECT password_hash FROM users WHERE id = ?',
        [adminId]
    );
    if (rows.length === 0) return false;
    return bcrypt.compare(password, rows[0].password_hash);
}

function toSqliteDateTime(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 19).replace('T', ' ');
}

function parseDbDateTime(value) {
    if (!value) return 0;
    const text = String(value).trim();
    if (!text) return 0;
    const normalized = text.includes('T') ? text : text.replace(' ', 'T');
    const parsed = Date.parse(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
    return Number.isNaN(parsed) ? 0 : parsed;
}

async function upsertSecurityIpBlock(ip, reason, detail, blockUntilMs) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        const error = new Error('Invalid IP');
        error.statusCode = 400;
        throw error;
    }
    if (isProtectedIp(normalizedIp)) {
        const error = new Error('Protected server IP cannot be blocked');
        error.statusCode = 400;
        throw error;
    }

    await db.execute(
        `INSERT INTO security_ip_blocks (ip, reason, detail, block_until, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(ip) DO UPDATE SET
             reason = excluded.reason,
             detail = excluded.detail,
             block_until = excluded.block_until,
             updated_at = CURRENT_TIMESTAMP`,
        [normalizedIp, reason, detail || '', toSqliteDateTime(blockUntilMs)]
    );

    return normalizedIp;
}

async function removeSecurityIpBlock(ip) {
    const normalizedIp = normalizeIp(ip);
    if (!normalizedIp) {
        const error = new Error('Invalid IP');
        error.statusCode = 400;
        throw error;
    }

    await db.execute('DELETE FROM security_ip_blocks WHERE ip = ?', [normalizedIp]);
    clearIpBlockState(normalizedIp);
    return normalizedIp;
}

async function getActiveBlocksByIps(ips = []) {
    const normalizedIps = Array.from(new Set(
        ips.map(normalizeIp).filter(Boolean)
    ));
    if (!normalizedIps.length) {
        return new Map();
    }

    const placeholders = normalizedIps.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT ip, reason, detail, block_until
         FROM security_ip_blocks
         WHERE ip IN (${placeholders})`,
        normalizedIps
    );

    const now = Date.now();
    const result = new Map();

    rows.forEach((row) => {
        if (isProtectedIp(row.ip)) {
            return;
        }

        const blockUntilMs = parseDbDateTime(row.block_until);
        if (blockUntilMs > now) {
            result.set(row.ip, {
                ip: row.ip,
                reason: row.reason || '',
                detail: row.detail || '',
                blockUntilMs
            });
        }
    });

    return result;
}

async function getActiveIpBlocks(limit = 200) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const [rows] = await db.execute(
        `SELECT ip, reason, detail, block_until, created_at, updated_at
         FROM security_ip_blocks
         ORDER BY updated_at DESC
         LIMIT ?`,
        [safeLimit]
    );

    const now = Date.now();
    return rows
        .map((row) => {
            if (isProtectedIp(row.ip)) {
                return null;
            }

            const blockUntilMs = parseDbDateTime(row.block_until);
            if (!blockUntilMs || blockUntilMs <= now) {
                return null;
            }

            return {
                ip: row.ip,
                reason: row.reason || '',
                detail: row.detail || '',
                blockUntil: new Date(blockUntilMs).toISOString(),
                createdAt: row.created_at || null,
                updatedAt: row.updated_at || null
            };
        })
        .filter(Boolean);
}

function buildLockReasonList(user = {}, loginLockUntilMs = 0) {
    const reasons = [];

    if (loginLockUntilMs > Date.now()) {
        reasons.push('login_failed_limit');
    }

    if (user.security_lock_reason) {
        reasons.push(String(user.security_lock_reason));
    }

    if (user.status === 'banned' && !reasons.includes('status_banned')) {
        reasons.push(user.security_lock_reason ? 'status_banned' : 'manual_or_status_ban');
    }

    return reasons;
}

async function getLockedAccounts(limit = 200) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 200, 1), 500);
    const [rows] = await db.execute(
        `SELECT id, email, full_name, role, status, created_at, last_login,
                failed_login_count, login_locked_until,
                security_lock_reason, security_locked_ip, security_locked_at,
                last_login_ip
         FROM users
         WHERE status = 'banned'
            OR login_locked_until IS NOT NULL
            OR security_lock_reason IS NOT NULL
         ORDER BY COALESCE(security_locked_at, login_locked_until, last_login, created_at) DESC
         LIMIT ?`,
        [safeLimit]
    );

    const now = Date.now();
    return rows
        .map((row) => {
            const loginLockUntilMs = parseDbDateTime(row.login_locked_until);
            const loginLockActive = loginLockUntilMs > now;
            const securityLocked = !!String(row.security_lock_reason || '').trim();
            const statusBanned = row.status === 'banned';
            const active = statusBanned || loginLockActive || securityLocked;

            if (!active) {
                return null;
            }

            return {
                id: row.id,
                email: row.email || '',
                full_name: row.full_name || '',
                role: row.role || 'user',
                status: row.status || 'active',
                failed_login_count: Number(row.failed_login_count || 0),
                last_login: row.last_login || null,
                last_login_ip: row.last_login_ip || '',
                login_locked_until: loginLockActive ? new Date(loginLockUntilMs).toISOString() : null,
                security_lock_reason: row.security_lock_reason || '',
                security_locked_ip: row.security_locked_ip || '',
                security_locked_at: row.security_locked_at || null,
                created_at: row.created_at || null,
                lock_reasons: buildLockReasonList(row, loginLockUntilMs)
            };
        })
        .filter(Boolean);
}

function parseBlockedTargetKey(value = '') {
    const input = String(value || '').trim();
    if (!input) {
        return {
            method: '',
            path: ''
        };
    }

    const firstSpaceIndex = input.indexOf(' ');
    if (firstSpaceIndex <= 0) {
        return {
            method: '',
            path: input
        };
    }

    return {
        method: input.slice(0, firstSpaceIndex).trim(),
        path: input.slice(firstSpaceIndex + 1).trim()
    };
}

async function getBlockedApiAnalytics(limit = 300) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
    const [rows] = await db.execute(
        `SELECT target_key, actor_ip, created_at
         FROM security_action_logs
         WHERE action_type = 'blocked_request'
         ORDER BY created_at DESC
         LIMIT ?`,
        [safeLimit]
    );

    const grouped = new Map();
    rows.forEach((row) => {
        const parsed = parseBlockedTargetKey(row.target_key);
        if (!String(parsed.path || '').startsWith('/api/')) {
            return;
        }

        const key = `${parsed.method} ${parsed.path}`.trim() || row.target_key || 'unknown';
        const current = grouped.get(key) || {
            endpoint: key,
            method: parsed.method || '',
            path: parsed.path || '',
            count: 0,
            lastBlockedAt: row.created_at || null,
            ips: new Set()
        };

        current.count += 1;
        current.lastBlockedAt = current.lastBlockedAt || row.created_at || null;
        if (row.actor_ip) {
            current.ips.add(row.actor_ip);
        }
        grouped.set(key, current);
    });

    const recentBlockedRequests = logService.getLogs(500)
        .filter((entry) => entry.type === 'security' && entry.action === 'blocked_request')
        .filter((entry) => String(entry.path || '').startsWith('/api/'))
        .slice(-50)
        .reverse()
        .map((entry) => ({
            method: entry.method || '',
            path: entry.path || '',
            endpoint: `${entry.method || ''} ${entry.path || ''}`.trim(),
            ip: entry.ip || '',
            reason: entry.reason || '',
            detail: entry.detail || '',
            at: entry.ts || null
        }));

    return {
        blockedApis: Array.from(grouped.values())
            .map((item) => ({
                endpoint: item.endpoint,
                method: item.method,
                path: item.path,
                count: item.count,
                lastBlockedAt: item.lastBlockedAt,
                sampleIps: Array.from(item.ips).slice(0, 5)
            }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return String(b.lastBlockedAt || '').localeCompare(String(a.lastBlockedAt || ''));
            }),
        recentBlockedRequests
    };
}

async function getSettingValueMap(keys = []) {
    if (!Array.isArray(keys) || !keys.length) return {};
    const placeholders = keys.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key IN (${placeholders})`,
        keys
    );
    const result = {};
    rows.forEach(item => {
        result[item.setting_key] = item.setting_value;
    });
    return result;
}

async function upsertSetting(key, value) {
    const [existing] = await db.execute(
        'SELECT id FROM system_settings WHERE setting_key = ?',
        [key]
    );
    if (existing.length > 0) {
        await db.execute(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
            [value, key]
        );
        return;
    }
    await db.execute(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
        [key, value]
    );
}

function ensureFramesDirectory() {
    if (!fs.existsSync(FRAMES_DIR)) {
        fs.mkdirSync(FRAMES_DIR, { recursive: true });
    }
}

function listFrameFiles() {
    ensureFramesDirectory();

    return fs.readdirSync(FRAMES_DIR)
        .filter(file => /\.(png|jpe?g|gif|webp)$/i.test(file))
        .map(file => {
            const filePath = path.join(FRAMES_DIR, file);
            const stats = fs.statSync(filePath);
            return {
                name: file,
                url: `/frames/${file}`,
                size: stats.size,
                updated_at: stats.mtime.toISOString()
            };
        })
        .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

const frameUpload = singleFileUpload({
    fieldName: 'file',
    storage: 'disk',
    maxFileSize: frameMaxFileSize,
    allowedMimeTypes: FRAME_ALLOWED_MIME_TYPES,
    destination: async () => {
        ensureFramesDirectory();
        return FRAMES_DIR;
    },
    filename: async (req, file) => {
        const originalName = file.originalname || `frame-${Date.now()}`;
        const ext = (path.extname(originalName) || '').toLowerCase() || '.png';
        const safeName = slugify(path.basename(originalName, ext)) || 'frame';
        return `${safeName}-${Date.now()}${ext}`;
    }
});

// All admin routes require admin role
router.use(authenticate);
router.use(authorize('admin'));

// GET /api/admin/frames
router.get('/frames', async (req, res) => {
    try {
        res.json({ success: true, data: listFrameFiles() });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/frames
router.post('/frames', frameUpload, async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    return res.json({
        success: true,
        data: {
            name: req.file.filename,
            url: `/frames/${req.file.filename}`,
            size: req.file.size
        }
    });
});

// DELETE /api/admin/frames/:name
router.delete('/frames/:name', async (req, res) => {
    try {
        const safeName = path.basename(req.params.name || '');
        if (!safeName || !/\.(png|jpe?g|gif|webp)$/i.test(safeName)) {
            return res.status(400).json({ success: false, message: 'Invalid frame name' });
        }

        const filePath = path.join(FRAMES_DIR, safeName);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Frame not found' });
        }

        fs.unlinkSync(filePath);
        await db.execute('UPDATE users SET frame_url = NULL WHERE frame_url = ?', [`/frames/${safeName}`]);

        res.json({ success: true, message: 'Frame deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/dashboard
router.get('/dashboard', async (req, res) => {
    try {
        // Total revenue
        const [revenue] = await db.execute(
            "SELECT setting_value as total_revenue FROM system_settings WHERE setting_key = 'total_revenue'"
        );

        // Total users
        const [totalUsers] = await db.execute(
            'SELECT COUNT(*) as total FROM users'
        );

        // Active users (logged in last 30 days)
        const [activeUsers] = await db.execute(
            "SELECT COUNT(*) as total FROM users WHERE last_login >= datetime('now', '-30 days')"
        );

        // Total products
        const [totalProducts] = await db.execute(
            "SELECT COUNT(*) as total FROM products WHERE status = 'active'"
        );

        const dbSizeBytes = await getDatabaseSizeBytes();

        // Revenue series (purchases only)
        const [dailyRows] = await db.execute(
            `SELECT strftime('%Y-%m-%d', created_at) as label, SUM(-amount) as revenue
             FROM transactions
             WHERE type = 'purchase'
             GROUP BY label
             ORDER BY label DESC
             LIMIT 30`
        );

        const [monthlyRows] = await db.execute(
            `SELECT strftime('%Y-%m', created_at) as label, SUM(-amount) as revenue
             FROM transactions
             WHERE type = 'purchase'
             GROUP BY label
             ORDER BY label DESC
             LIMIT 12`
        );

        const normalizeSeries = (rows = []) =>
            rows
                .map(r => ({ label: r.label, value: parseFloat(r.revenue || 0) }))
                .sort((a, b) => a.label.localeCompare(b.label));

        const systemStats = getSystemStats();
        const requestStats = logService.getRequestStats ? logService.getRequestStats() : null;

        res.json({
            success: true,
            data: {
                totalRevenue: parseFloat(revenue[0]?.total_revenue || 0),
                totalUsers: totalUsers[0].total,
                activeUsers: activeUsers[0].total,
                totalProducts: totalProducts[0].total,
                dbSizeBytes: parseInt(dbSizeBytes || 0, 10),
                dailyRevenue: normalizeSeries(dailyRows),
                monthlyRevenue: normalizeSeries(monthlyRows),
                systemStats,
                requestStats
            }
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, role } = req.query;
        const offset = (page - 1) * limit;

        let query = 'SELECT id, email, full_name, avatar, role, balance, status, is_verified, created_at, last_login FROM users';
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('status = ?');
            params.push(status);
        }

        if (role) {
            conditions.push('role = ?');
            params.push(role);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [users] = await db.execute(query, params);

        res.json({
            success: true,
            data: users
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// GET /api/admin/users/inactive
router.get('/users/inactive', async (req, res) => {
    try {
        const days = Math.max(parseInt(req.query.days || '30', 10), 1);
        const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
        const [rows] = await db.execute(
            `SELECT id, email, full_name, role, status, is_verified, created_at, last_login
             FROM users
             WHERE role != 'admin'
               AND (
                    (last_login IS NULL AND created_at < datetime('now', '-' || ? || ' days'))
                    OR (last_login < datetime('now', '-' || ? || ' days'))
               )
             ORDER BY COALESCE(last_login, created_at) ASC
             LIMIT ?`,
            [days, days, limit]
        );
        res.json({ success: true, data: rows, days });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/users/inactive
router.delete('/users/inactive', async (req, res) => {
    try {
        const days = Math.max(parseInt(req.query.days || '30', 10), 1);
        const [result] = await db.execute(
            `DELETE FROM users
             WHERE role != 'admin'
               AND (
                    (last_login IS NULL AND created_at < datetime('now', '-' || ? || ' days'))
                    OR (last_login < datetime('now', '-' || ? || ' days'))
               )`,
            [days, days]
        );
        res.json({ success: true, deleted: result.affectedRows || 0 });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/users/:id/inspect
router.get('/users/:id/inspect', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        if (!Number.isFinite(userId)) {
            return res.status(400).json({ success: false, message: 'Invalid user id' });
        }

        const [users] = await db.execute(
            `SELECT id, email, full_name, avatar, gender, role, status, balance, is_verified, last_login, created_at,
                    failed_login_count, last_failed_login_at, last_failed_login_ip, login_locked_until,
                    register_ip, last_login_ip, security_lock_reason, security_locked_ip, security_locked_at
             FROM users WHERE id = ?`,
            [userId]
        );
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        const user = users[0];

        const [transactions] = await db.execute(
            `SELECT type, amount, description, created_at
             FROM transactions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 10`,
            [userId]
        );

        const [purchases] = await db.execute(
            `SELECT p.id, p.product_id, p.price_paid, p.created_at, pr.title
             FROM purchases p
             LEFT JOIN products pr ON pr.id = p.product_id
             WHERE p.user_id = ?
             ORDER BY p.created_at DESC
             LIMIT 5`,
            [userId]
        );

        const [deposits] = await db.execute(
            `SELECT id, amount, status, created_at, processed_at
             FROM deposit_requests
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 5`,
            [userId]
        );

        const filteredLogs = logService
            .getLogs(500)
            .filter(l => l.userId === userId || (user.email && l.email === user.email));

        const recentLogs = filteredLogs
            .slice(-10)
            .map(l => ({
                type: 'log',
                text: `${l.method || ''} ${l.path || ''}${l.ip ? ` • ${l.ip}` : ''}`.trim(),
                path: l.path,
                method: l.method,
                status: l.status,
                ip: l.ip || '',
                at: l.ts
            }));

        const ipMap = new Map();
        const pushIpCandidate = (ip, source, at) => {
            const normalizedIp = normalizeIp(ip);
            if (!normalizedIp) return;

            const existing = ipMap.get(normalizedIp) || {
                ip: normalizedIp,
                lastSeenAt: at || null,
                sources: new Set()
            };

            if (at && (!existing.lastSeenAt || new Date(at) > new Date(existing.lastSeenAt))) {
                existing.lastSeenAt = at;
            }

            existing.sources.add(source);
            ipMap.set(normalizedIp, existing);
        };

        pushIpCandidate(user.register_ip, 'register_ip', user.created_at);
        pushIpCandidate(user.last_login_ip, 'last_login_ip', user.last_login || user.created_at);
        pushIpCandidate(user.last_failed_login_ip, 'failed_login', user.last_failed_login_at || user.last_login || user.created_at);
        filteredLogs.forEach((log) => {
            pushIpCandidate(log.ip, log.type || 'log', log.ts);
        });

        const activeBlockMap = await getActiveBlocksByIps(Array.from(ipMap.keys()));
        const recentIps = Array.from(ipMap.values())
            .map((entry) => {
                const activeBlock = activeBlockMap.get(entry.ip);
                return {
                    ip: entry.ip,
                    lastSeenAt: entry.lastSeenAt,
                    sources: Array.from(entry.sources),
                    block: activeBlock ? {
                        reason: activeBlock.reason,
                        detail: activeBlock.detail,
                        blockUntil: new Date(activeBlock.blockUntilMs).toISOString(),
                        isManual: activeBlock.reason === MANUAL_ADMIN_BLOCK_REASON
                    } : null
                };
            })
            .sort((a, b) => new Date(b.lastSeenAt || 0) - new Date(a.lastSeenAt || 0));

        const activities = [];

        for (const t of transactions) {
            activities.push({
                type: t.type || 'transaction',
                text: t.description || t.type,
                amount: t.amount,
                at: t.created_at
            });
        }

        for (const p of purchases) {
            activities.push({
                type: 'purchase',
                text: `Mua ${p.title || 'sản phẩm #' + p.product_id}`,
                amount: -Math.abs(p.price_paid || 0),
                at: p.created_at
            });
        }

        for (const d of deposits) {
            activities.push({
                type: 'deposit',
                text: `Nạp ${d.amount} (${d.status})`,
                amount: d.amount,
                at: d.created_at
            });
        }

        activities.push(...recentLogs);

        activities.sort((a, b) => new Date(b.at) - new Date(a.at));

        res.json({
            success: true,
            data: {
                user,
                transactions,
                purchases,
                deposits,
                activities: activities.slice(0, 15),
                recentIps
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/users/:id/status (lock/unlock with admin password)
router.post('/users/:id/status', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const { status, admin_password } = req.body;

        if (!['active', 'banned'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }
        if (!admin_password) {
            return res.status(400).json({ success: false, message: 'Admin password is required' });
        }
        if (userId === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot change status of self' });
        }

        const ok = await verifyAdminPassword(req.user.id, admin_password);
        if (!ok) {
            return res.status(403).json({ success: false, message: 'Wrong admin password' });
        }

        const [exists] = await db.execute(
            'SELECT id FROM users WHERE id = ?',
            [userId]
        );
        if (exists.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        await db.execute(
            'UPDATE users SET status = ? WHERE id = ?',
            [status, userId]
        );
        if (status === 'active') {
            const unlockContext = await getUserUnlockContext(userId);
            await clearSecurityLockForUser(userId);
            await loginProtectionService.clearProtectionState({
                userId,
                email: unlockContext?.email || '',
                ip: unlockContext?.last_failed_login_ip || unlockContext?.security_locked_ip || unlockContext?.last_login_ip || '',
                addGrace: true
            });
        }

        res.json({ success: true, status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/users/:id/verified
router.put('/users/:id/verified', async (req, res) => {
    try {
        const userId = parseInt(req.params.id, 10);
        const normalizedVerified = req.body?.is_verified ? 1 : 0;
        const target = await getUserById(userId);

        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (isPrimaryAdmin(target) && normalizedVerified !== 1) {
            return res.status(403).json({
                success: false,
                message: 'Admin mac dinh luon co tich xanh'
            });
        }

        await db.execute(
            'UPDATE users SET is_verified = ? WHERE id = ?',
            [normalizedVerified, userId]
        );

        res.json({
            success: true,
            data: {
                id: userId,
                is_verified: normalizedVerified
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req, res) => {
    try {
        const { role } = req.body;

        if (!['user', 'seller', 'admin'].includes(role)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid role'
            });
        }

        const target = await getUserById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (isPrimaryAdmin(target) && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể chỉnh sửa vai trò của admin chính'
            });
        }

        if (role === 'admin' && !isPrimaryAdmin(target)) {
            return res.status(403).json({
                success: false,
                message: 'Không được tăng cấp user lên admin'
            });
        }

        if (target.role === 'admin' && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ admin chính mới được chỉnh sửa vai trò của admin'
            });
        }

        await db.execute(
            'UPDATE users SET role = ? WHERE id = ?',
            [role, req.params.id]
        );

        res.json({
            success: true,
            message: 'User role updated'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// PUT /api/admin/users/:id/status
router.put('/users/:id/status', async (req, res) => {
    try {
        const { status } = req.body;

        if (!['active', 'banned'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status'
            });
        }

        const target = await getUserById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (isPrimaryAdmin(target) && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể khóa hoặc mở khóa admin chính'
            });
        }

        await db.execute(
            'UPDATE users SET status = ? WHERE id = ?',
            [status, req.params.id]
        );
        if (status === 'active') {
            const unlockContext = await getUserUnlockContext(req.params.id);
            await clearSecurityLockForUser(req.params.id);
            await loginProtectionService.clearProtectionState({
                userId: req.params.id,
                email: unlockContext?.email || '',
                ip: unlockContext?.last_failed_login_ip || unlockContext?.security_locked_ip || unlockContext?.last_login_ip || '',
                addGrace: true
            });
        }

        res.json({
            success: true,
            message: `User ${status === 'banned' ? 'banned' : 'unbanned'} successfully`
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// POST /api/admin/revenue/reset
router.post('/revenue/reset', async (req, res) => {
    try {
        await db.execute(
            "UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'total_revenue'"
        );

        res.json({
            success: true,
            message: 'Revenue reset successfully'
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// GET /api/admin/deposit-requests
router.get('/deposit-requests', async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const params = [];
        let where = '';

        if (status) {
            where = 'WHERE dr.status = ?';
            params.push(status);
        }

        const [rows] = await db.execute(
            `SELECT dr.*, u.email, u.full_name
             FROM deposit_requests dr
             JOIN users u ON u.id = dr.user_id
             ${where}
             ORDER BY dr.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/deposit-requests/:id/approve
router.put('/deposit-requests/:id/approve', async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { approve = true, admin_note } = req.body;

        await connection.beginTransaction();

        const [rows] = await connection.execute(
            'SELECT * FROM deposit_requests WHERE id = ?',
            [req.params.id]
        );

        if (rows.length === 0) {
            throw new Error('Deposit request not found');
        }

        const request = rows[0];

        if (request.status !== 'pending') {
            throw new Error('Request already processed');
        }

        const newStatus = approve ? 'approved' : 'rejected';

        await connection.execute(
            `UPDATE deposit_requests
             SET status = ?, admin_note = ?, approved_by = ?, processed_at = datetime('now')
             WHERE id = ?`,
            [newStatus, admin_note || null, req.user.id, req.params.id]
        );

        if (approve) {
            const amount = parseFloat(request.amount);
            if (!Number.isFinite(amount) || amount <= 0) {
                throw new Error('Invalid deposit amount');
            }

            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [request.user_id]
            );

            if (users.length === 0) {
                throw new Error('User not found');
            }

            const before = parseFloat(users[0].balance || 0);
            const after = before + amount;

            const [updateResult] = await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [after, request.user_id]
            );

            if (updateResult.affectedRows === 0) {
                throw new Error('Failed to update user balance');
            }

            await connection.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id)
                 VALUES (?, 'deposit', ?, ?, ?, ?, ?)`,
                [request.user_id, amount, before, after, 'Deposit approved', request.id]
            );
        }

        await connection.commit();

        res.json({ success: true, message: `Deposit ${newStatus}` });
    } catch (error) {
        await connection.rollback();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
});

// POST /api/admin/balance/adjust
router.post('/balance/adjust', async (req, res) => {
    const connection = await db.getConnection();
    try {
        const { user_id, amount, description } = req.body;

        if (!user_id || !amount) {
            throw new Error('user_id and amount are required');
        }

        const target = await getUserById(user_id);
        if (!target) {
            throw new Error('User not found');
        }

        if (isPrimaryAdmin(target) && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể chỉnh số dư của admin chính'
            });
        }

        await connection.beginTransaction();

        const [users] = await connection.execute(
            'SELECT balance FROM users WHERE id = ?',
            [user_id]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const before = users[0].balance;
        const after = before + parseFloat(amount);

        await connection.execute(
            'UPDATE users SET balance = ? WHERE id = ?',
            [after, user_id]
        );

        await connection.execute(
            `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
             VALUES (?, 'admin_adjust', ?, ?, ?, ?)`,
            [user_id, amount, before, after, description || 'Admin balance adjust']
        );

        await connection.commit();
        res.json({ success: true, message: 'Balance updated', data: { balance: after } });
    } catch (error) {
        await connection.rollback();
        res.status(400).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
});

// GET /api/admin/products
router.get('/products', async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const offset = (page - 1) * limit;
        const conditions = [];
        const params = [];

        if (status) {
            conditions.push('p.status = ?');
            params.push(status);
        }
        if (search) {
            conditions.push('(p.title LIKE ? OR p.description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const [rows] = await db.execute(
            `SELECT p.*, u.full_name as seller_name
             FROM products p
             JOIN users u ON u.id = p.seller_id
             ${where}
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/categories
router.get('/categories', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, name, slug, description, icon, parent_id, display_order, is_active, created_at
             FROM categories
             ORDER BY display_order ASC, id ASC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/categories
router.post('/categories', async (req, res) => {
    try {
        const { name, slug, icon, display_order = 0, is_active = true } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        let finalSlug = (slug && slug.trim()) ? slugify(slug) : slugify(name);
        if (!finalSlug) finalSlug = `category-${Date.now()}`;

        const [exists] = await db.execute('SELECT id FROM categories WHERE slug = ?', [finalSlug]);
        if (exists.length > 0) {
            finalSlug = `${finalSlug}-${Date.now()}`;
        }

        const [result] = await db.execute(
            `INSERT INTO categories (name, slug, icon, display_order, is_active)
             VALUES (?, ?, ?, ?, ?)`,
            [name.trim(), finalSlug, icon || null, parseInt(display_order, 10) || 0, !!is_active]
        );

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/categories/:id
router.put('/categories/:id', async (req, res) => {
    try {
        const { name, slug, icon, display_order = 0, is_active = true } = req.body;
        const id = req.params.id;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }
        let finalSlug = (slug && slug.trim()) ? slugify(slug) : slugify(name);
        if (!finalSlug) finalSlug = `category-${Date.now()}`;

        const [exists] = await db.execute(
            'SELECT id FROM categories WHERE slug = ? AND id != ?',
            [finalSlug, id]
        );
        if (exists.length > 0) {
            finalSlug = `${finalSlug}-${Date.now()}`;
        }

        await db.execute(
            `UPDATE categories
             SET name = ?, slug = ?, icon = ?, display_order = ?, is_active = ?
             WHERE id = ?`,
            [name.trim(), finalSlug, icon || null, parseInt(display_order, 10) || 0, !!is_active, id]
        );

        res.json({ success: true, message: 'Category updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/categories/:id
router.delete('/categories/:id', async (req, res) => {
    try {
        await db.execute('DELETE FROM categories WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/products/:id/status
router.put('/products/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        if (!['active', 'inactive', 'banned'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const [rows] = await db.execute(
            `SELECT u.email
             FROM products p
             JOIN users u ON u.id = p.seller_id
             WHERE p.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (rows[0].email === PRIMARY_ADMIN_EMAIL && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể chỉnh trạng thái sản phẩm của admin chính'
            });
        }

        await db.execute('UPDATE products SET status = ? WHERE id = ?', [status, req.params.id]);
        res.json({ success: true, message: 'Product status updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT u.email
             FROM products p
             JOIN users u ON u.id = p.seller_id
             WHERE p.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (rows[0].email === PRIMARY_ADMIN_EMAIL && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể xóa sản phẩm của admin chính'
            });
        }

        await db.execute('DELETE FROM products WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Product deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/posts
router.get('/posts', async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        const [rows] = await db.execute(
            `SELECT p.*, u.full_name
             FROM posts p
             JOIN users u ON u.id = p.user_id
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [parseInt(limit), offset]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/posts/:id
router.delete('/posts/:id', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT u.email
             FROM posts p
             JOIN users u ON u.id = p.user_id
             WHERE p.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        if (rows[0].email === PRIMARY_ADMIN_EMAIL && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể xóa bài đăng của admin chính'
            });
        }

        await db.execute('DELETE FROM posts WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Post deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/messages
router.get('/messages', async (req, res) => {
    try {
        const { page = 1, limit = 30 } = req.query;
        const offset = (page - 1) * limit;

        const [rows] = await db.execute(
            `SELECT m.*, 
                    us.full_name as sender_name, 
                    ur.full_name as receiver_name
             FROM messages m
             JOIN users us ON us.id = m.sender_id
             JOIN users ur ON ur.id = m.receiver_id
             ORDER BY m.created_at DESC
             LIMIT ? OFFSET ?`,
            [parseInt(limit), offset]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/messages/:id
router.delete('/messages/:id', async (req, res) => {
    try {
        await messageService.deleteMessage(req.params.id, req.user.id, req.user.role);
        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/support
router.get('/support', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT sr.*, u.email
             FROM support_requests sr
             JOIN users u ON u.id = sr.user_id
             ORDER BY sr.created_at DESC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/support/:id/reply
router.put('/support/:id/reply', async (req, res) => {
    try {
        const { reply } = req.body;
        if (!reply) {
            return res.status(400).json({ success: false, message: 'Reply is required' });
        }
        await db.execute(
            `UPDATE support_requests
             SET admin_reply = ?, status = 'replied', replied_at = datetime('now')
             WHERE id = ?`,
            [reply, req.params.id]
        );
        res.json({ success: true, message: 'Replied' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// GET /api/admin/support/threads
router.get('/support/threads', async (req, res) => {
    try {
        const [adminRows] = await db.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
        if (adminRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const adminId = adminRows[0].id;

        const [threads] = await db.execute(
            `SELECT u.id as user_id, u.email, u.full_name, m.content, m.created_at
             FROM users u
             JOIN (
                SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS user_id,
                       MAX(created_at) AS last_time
                FROM messages
                WHERE sender_id = ? OR receiver_id = ?
                GROUP BY user_id
             ) t ON t.user_id = u.id
             JOIN messages m ON m.created_at = t.last_time
             WHERE (m.sender_id = u.id AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = u.id)
             ORDER BY t.last_time DESC`,
            [adminId, adminId, adminId, adminId, adminId]
        );

        res.json({ success: true, data: threads });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/support/thread/:userId
router.get('/support/thread/:userId', async (req, res) => {
    try {
        const [adminRows] = await db.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
        if (adminRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const adminId = adminRows[0].id;
        const userId = req.params.userId;
        const [rows] = await db.execute(
            `SELECT * FROM messages
             WHERE (sender_id = ? AND receiver_id = ?)
                OR (sender_id = ? AND receiver_id = ?)
             ORDER BY created_at ASC`,
            [userId, adminId, adminId, userId]
        );
        res.json({ success: true, data: rows, admin_id: adminId });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/support/thread/:userId
router.post('/support/thread/:userId', async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) {
            return res.status(400).json({ success: false, message: 'Content is required' });
        }
        const [adminRows] = await db.execute("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
        if (adminRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Admin not found' });
        }
        const adminId = adminRows[0].id;
        const userId = req.params.userId;

        const [result] = await db.execute(
            'INSERT INTO messages (sender_id, receiver_id, message_type, content) VALUES (?, ?, ?, ?)',
            [adminId, userId, 'text', content]
        );

        res.json({ success: true, data: { id: result.insertId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
    try {
        const target = await getUserById(req.params.id);
        if (!target) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (isPrimaryAdmin(target) && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Không thể xóa tài khoản admin chính'
            });
        }

        if (target.role === 'admin' && !isRequestFromPrimary(req)) {
            return res.status(403).json({
                success: false,
                message: 'Chỉ admin chính mới được xóa tài khoản admin'
            });
        }

        await db.execute('DELETE FROM users WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/ai-config
router.get('/ai-config', async (req, res) => {
    try {
        const keys = ['ai_api_key', 'ai_name', 'ai_personality', 'ai_knowledge', 'ai_system_prompt'];
        const data = await getSettingValueMap(keys);
        const apiKey = (data.ai_api_key || '').toString();
        const maskedApiKey = apiKey
            ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`
            : '';

        res.json({
            success: true,
            data: {
                ai_name: data.ai_name || '',
                ai_personality: data.ai_personality || '',
                ai_knowledge: data.ai_knowledge || '',
                ai_system_prompt: data.ai_system_prompt || '',
                ai_api_key_masked: maskedApiKey,
                has_ai_api_key: !!apiKey
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/ai-config
router.put('/ai-config', async (req, res) => {
    try {
        const payload = req.body || {};
        const aiName = (payload.ai_name || '').toString().trim();
        const aiPersonality = (payload.ai_personality || '').toString().trim();
        const aiKnowledge = (payload.ai_knowledge || '').toString().trim();
        const aiSystemPrompt = (payload.ai_system_prompt || '').toString().trim();
        const aiApiKeyRaw = (payload.ai_api_key || '').toString().trim();
        const clearApiKey = payload.clear_ai_api_key === true;

        if (aiName.length > 120) {
            return res.status(400).json({ success: false, message: 'AI name is too long (max 120)' });
        }
        if (aiPersonality.length > 1000) {
            return res.status(400).json({ success: false, message: 'AI personality is too long (max 1000)' });
        }
        if (aiKnowledge.length > 2000) {
            return res.status(400).json({ success: false, message: 'AI knowledge is too long (max 2000)' });
        }
        if (aiSystemPrompt.length > 4000) {
            return res.status(400).json({ success: false, message: 'AI system prompt is too long (max 4000)' });
        }

        await upsertSetting('ai_name', aiName);
        await upsertSetting('ai_personality', aiPersonality);
        await upsertSetting('ai_knowledge', aiKnowledge);
        await upsertSetting('ai_system_prompt', aiSystemPrompt);

        if (clearApiKey) {
            await upsertSetting('ai_api_key', '');
        } else if (aiApiKeyRaw) {
            await upsertSetting('ai_api_key', aiApiKeyRaw);
        }

        res.json({ success: true, message: 'AI configuration updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// PUT /api/admin/settings/:key
router.put('/settings/:key', async (req, res) => {
    try {
        const { value } = req.body;
        const key = req.params.key;
        const [existing] = await db.execute(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [key]
        );

        if (existing.length > 0) {
            await db.execute(
                'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
                [value, key]
            );
        } else {
            await db.execute(
                'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)',
                [key, value]
            );
        }
        res.json({ success: true, message: 'Setting updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/notifications
router.get('/notifications', async (req, res) => {
    try {
        await db.execute(
            "DELETE FROM notifications WHERE created_at < datetime('now', '-12 hours')"
        );
        const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
        const [rows] = await db.execute(
            `SELECT n.*, u.email as target_email, u.full_name as target_name
             FROM notifications n
             LEFT JOIN users u ON u.id = n.target_user_id
             ORDER BY n.created_at DESC
             LIMIT ?`,
            [limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/storage-info
router.get('/storage-info', async (req, res) => {
    try {
        const dbSizeBytes = await getDatabaseSizeBytes();
        const tableRows = await getTableStats();
        const [counts] = await db.execute(
            `SELECT
                (SELECT COUNT(*) FROM users) AS users,
                (SELECT COUNT(*) FROM products) AS products,
                (SELECT COUNT(*) FROM posts) AS posts,
                (SELECT COUNT(*) FROM messages) AS messages,
                (SELECT COUNT(*) FROM community_messages) AS community_messages,
                (SELECT COUNT(*) FROM notifications) AS notifications,
                (SELECT COUNT(*) FROM purchases) AS purchases
            `
        );
        res.json({
            success: true,
            data: {
                dbSizeBytes,
                counts: counts[0] || {},
                tables: tableRows || []
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/backup/export
router.get('/backup/export', async (req, res) => {
    try {
        const data = await exportAll();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename=\"data.json\"');
        res.send(JSON.stringify(data, null, 2));
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/backup/telegram
router.post('/backup/telegram', async (req, res) => {
    try {
        queueFullBackup('manual', { by: req.user.id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/notifications
router.post('/notifications', async (req, res) => {
    try {
        const {
            title,
            content = '',
            image_url = null,
            target_user_id = null,
            target_user_ids = null,
            target_email = null,
            is_important = false,
            dismiss_hours = 2
        } = req.body;
        if (!title || !title.trim()) {
            return res.status(400).json({ success: false, message: 'Title is required' });
        }

        let resolvedTargetId = target_user_id ? parseInt(target_user_id, 10) : null;
        const targetEmail = target_email ? target_email.trim() : '';

        if (targetEmail) {
            const [targets] = await db.execute(
                'SELECT id FROM users WHERE email = ?',
                [targetEmail]
            );
            if (targets.length === 0) {
                return res.status(400).json({ success: false, message: 'Target user not found' });
            }
            resolvedTargetId = targets[0].id;
        } else if (resolvedTargetId) {
            const [targets] = await db.execute(
                'SELECT id FROM users WHERE id = ?',
                [resolvedTargetId]
            );
            if (targets.length === 0) {
                return res.status(400).json({ success: false, message: 'Target user not found' });
            }
        }

        const ids = [];
        const normalizedTitle = title.trim();
        const normalizedContent = content.trim();
        const normalizedImage = image_url ? String(image_url).trim() : null;
        const normalizedImportant = is_important === true || is_important === 1 || is_important === '1';
        const normalizedDismissHours = Number.isFinite(Number(dismiss_hours))
            ? Math.min(Math.max(parseInt(dismiss_hours, 10), 1), 168)
            : 2;

        if (Array.isArray(target_user_ids) && target_user_ids.length) {
            const uniqueIds = [...new Set(target_user_ids.map(id => parseInt(id, 10)).filter(id => Number.isFinite(id)))];
            if (!uniqueIds.length) {
                return res.status(400).json({ success: false, message: 'Target user not found' });
            }
            const placeholders = uniqueIds.map(() => '?').join(',');
            const [targets] = await db.execute(
                `SELECT id FROM users WHERE id IN (${placeholders})`,
                uniqueIds
            );
            const existingIds = new Set(targets.map(t => t.id));
            const filtered = uniqueIds.filter(id => existingIds.has(id));
            if (!filtered.length) {
                return res.status(400).json({ success: false, message: 'Target user not found' });
            }

            for (const userId of filtered) {
                const id = await notificationService.createNotification({
                    title: normalizedTitle,
                    content: normalizedContent,
                    image_url: normalizedImage,
                    is_important: normalizedImportant,
                    dismiss_hours: normalizedDismissHours,
                    target_user_id: userId,
                    created_by: req.user.id
                });
                ids.push(id);
            }
        } else {
            const id = await notificationService.createNotification({
                title: normalizedTitle,
                content: normalizedContent,
                image_url: normalizedImage,
                is_important: normalizedImportant,
                dismiss_hours: normalizedDismissHours,
                target_user_id: resolvedTargetId || null,
                created_by: req.user.id
            });
            ids.push(id);
        }

        res.json({ success: true, data: { ids } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/api-keys
router.get('/api-keys', async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, name, created_at, revoked_at
             FROM api_keys
             ORDER BY created_at DESC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/logs
router.get('/logs', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
        const logs = logService.getLogs(limit);
        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/admin/security-overview
router.get('/security-overview', async (req, res) => {
    try {
        const [activeIpBlocks, lockedAccounts, blockedApiAnalytics] = await Promise.all([
            getActiveIpBlocks(200),
            getLockedAccounts(200),
            getBlockedApiAnalytics(400)
        ]);

        res.json({
            success: true,
            data: {
                summary: {
                    blockedIpCount: activeIpBlocks.length,
                    lockedAccountCount: lockedAccounts.length,
                    blockedApiEndpointCount: blockedApiAnalytics.blockedApis.length,
                    blockedApiEventCount: blockedApiAnalytics.blockedApis.reduce((sum, item) => sum + Number(item.count || 0), 0)
                },
                activeIpBlocks,
                lockedAccounts,
                blockedApis: blockedApiAnalytics.blockedApis,
                recentBlockedRequests: blockedApiAnalytics.recentBlockedRequests
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/ip-blocks/block
router.post('/ip-blocks/block', async (req, res) => {
    try {
        const { ip, admin_password, note = '' } = req.body || {};
        if (!admin_password) {
            return res.status(400).json({ success: false, message: 'Admin password is required' });
        }

        const ok = await verifyAdminPassword(req.user.id, admin_password);
        if (!ok) {
            return res.status(403).json({ success: false, message: 'Admin password incorrect' });
        }

        const normalizedIp = normalizeIp(ip);
        if (!normalizedIp) {
            return res.status(400).json({ success: false, message: 'IP không hợp lệ' });
        }

        if (isProtectedIp(normalizedIp)) {
            return res.status(400).json({ success: false, message: 'IP server/bao ve khong duoc phep chan' });
        }

        const safeNote = String(note || '').trim().slice(0, 300);
        const blockUntilMs = Date.now() + MANUAL_ADMIN_BLOCK_MS;
        const detailParts = [`blocked_by=${req.user.id}`];
        if (req.user.email) detailParts.push(`admin_email=${req.user.email}`);
        if (safeNote) detailParts.push(`note=${safeNote}`);
        const detail = detailParts.join('; ');

        await upsertSecurityIpBlock(normalizedIp, MANUAL_ADMIN_BLOCK_REASON, detail, blockUntilMs);
        blockIpTemporarily(normalizedIp, MANUAL_ADMIN_BLOCK_REASON, detail, MANUAL_ADMIN_BLOCK_MS);

        logService.recordSecurity({
            action: 'admin_manual_ip_block',
            ip: normalizedIp,
            reason: MANUAL_ADMIN_BLOCK_REASON,
            detail,
            blockUntil: new Date(blockUntilMs).toISOString()
        });

        res.json({
            success: true,
            data: {
                ip: normalizedIp,
                reason: MANUAL_ADMIN_BLOCK_REASON,
                blockUntil: new Date(blockUntilMs).toISOString()
            }
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/ip-blocks/unblock
router.post('/ip-blocks/unblock', async (req, res) => {
    try {
        const { ip, admin_password } = req.body || {};
        if (!admin_password) {
            return res.status(400).json({ success: false, message: 'Admin password is required' });
        }

        const ok = await verifyAdminPassword(req.user.id, admin_password);
        if (!ok) {
            return res.status(403).json({ success: false, message: 'Admin password incorrect' });
        }

        const normalizedIp = await removeSecurityIpBlock(ip);
        const unlockedUsers = await unlockAccountsByIp(normalizedIp, SHARED_IP_SECURITY_LOCK_REASON);

        await loginProtectionService.clearProtectionState({
            ip: normalizedIp,
            addGrace: true
        });

        for (const user of unlockedUsers) {
            await loginProtectionService.clearProtectionState({
                userId: user.id,
                email: user.email || '',
                ip: normalizedIp,
                addGrace: true
            });
        }

        logService.recordSecurity({
            action: 'admin_manual_ip_unblock',
            ip: normalizedIp,
            reason: 'manual_unblock',
            detail: `unblocked_by=${req.user.id}${req.user.email ? `; admin_email=${req.user.email}` : ''}; unlocked_users=${unlockedUsers.length}`
        });

        res.json({
            success: true,
            data: {
                ip: normalizedIp,
                unlockedUsers
            }
        });
    } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, message: error.message });
    }
});

// POST /api/admin/api-keys
router.post('/api-keys', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required' });
        }

        const crypto = require('crypto');
        const rawKey = crypto.randomBytes(32).toString('hex');
        const hash = crypto.createHash('sha256').update(rawKey).digest('hex');

        const [result] = await db.execute(
            'INSERT INTO api_keys (name, key_hash, created_by) VALUES (?, ?, ?)',
            [name.trim(), hash, req.user.id]
        );

        res.json({ success: true, data: { id: result.insertId, key: rawKey } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/admin/api-keys/:id
router.delete('/api-keys/:id', async (req, res) => {
    try {
        await db.execute(
            "UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?",
            [req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================
// SHARE DATA (chiase.json)
// ============================================

const SHARE_CATEGORIES = [
    {
        key: 'products_inactive',
        label: 'Sản phẩm cũ',
        description: 'Sản phẩm inactive/banned hoặc đăng hơn 120 ngày trước'
    },
    {
        key: 'users_inactive',
        label: 'Tài khoản cũ',
        description: 'Tài khoản không hoạt động trên 180 ngày (trừ admin)'
    },
    {
        key: 'posts_old',
        label: 'Bài viết cũ',
        description: 'Bài viết đăng hơn 90 ngày trước'
    }
];

function mergeById(existing = [], incoming = []) {
    const map = new Map();
    existing.forEach(item => {
        if (item && item.id !== undefined && item.id !== null) {
            map.set(String(item.id), item);
        }
    });
    incoming.forEach(item => {
        if (item && item.id !== undefined && item.id !== null) {
            map.set(String(item.id), item);
        }
    });
    return Array.from(map.values());
}

async function exportArchivedProducts() {
    const [products] = await db.execute(
        `SELECT p.*,
                c.name as category_name,
                c.slug as category_slug,
                u.full_name as seller_name,
                u.avatar as seller_avatar,
                u.gender as seller_gender,
                u.email as seller_email
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN users u ON p.seller_id = u.id
         WHERE p.status != 'active'
            OR p.created_at < datetime('now', '-120 days')
         ORDER BY p.created_at DESC`
    );

    const productIds = products.map(p => p.id);
    const imagesMap = {};
    const categoriesMap = {};

    if (productIds.length > 0) {
        const placeholders = productIds.map(() => '?').join(',');
        const [images] = await db.execute(
            `SELECT * FROM product_images
             WHERE product_id IN (${placeholders})
             ORDER BY product_id ASC, display_order ASC, id ASC`,
            productIds
        );
        images.forEach(img => {
            if (!imagesMap[img.product_id]) imagesMap[img.product_id] = [];
            imagesMap[img.product_id].push(img);
        });

        const [categories] = await db.execute(
            `SELECT pc.product_id, c.id, c.name, c.slug
             FROM product_categories pc
             JOIN categories c ON c.id = pc.category_id
             WHERE pc.product_id IN (${placeholders})`,
            productIds
        );
        categories.forEach(item => {
            if (!categoriesMap[item.product_id]) categoriesMap[item.product_id] = [];
            categoriesMap[item.product_id].push({
                id: item.id,
                name: item.name,
                slug: item.slug
            });
        });
    }

    return products.map(product => ({
        ...product,
        main_image: (product.main_image || '').toString().trim() || (imagesMap[product.id] || [])[0]?.image_url || null,
        gallery: imagesMap[product.id] || [],
        categories: categoriesMap[product.id] || (product.category_id ? [{
            id: product.category_id,
            name: product.category_name,
            slug: product.category_slug
        }] : []),
        is_archived: true
    }));
}

async function exportArchivedPosts() {
    const [posts] = await db.execute(
        `SELECT p.*, u.full_name, u.avatar, u.gender
         FROM posts p
         JOIN users u ON u.id = p.user_id
         WHERE p.created_at < datetime('now', '-90 days')
         ORDER BY p.created_at DESC`
    );

    const postIds = posts.map(p => p.id);
    const mediaMap = {};
    const commentsMap = {};
    const likeCountMap = {};

    if (postIds.length > 0) {
        const placeholders = postIds.map(() => '?').join(',');
        const [media] = await db.execute(
            `SELECT * FROM post_media WHERE post_id IN (${placeholders})`,
            postIds
        );
        media.forEach(item => {
            if (!mediaMap[item.post_id]) mediaMap[item.post_id] = [];
            mediaMap[item.post_id].push(item);
        });

        const [comments] = await db.execute(
            `SELECT c.*, u.full_name, u.avatar, u.gender
             FROM post_comments c
             JOIN users u ON u.id = c.user_id
             WHERE c.post_id IN (${placeholders})
             ORDER BY c.created_at ASC`,
            postIds
        );
        comments.forEach(item => {
            if (!commentsMap[item.post_id]) commentsMap[item.post_id] = [];
            commentsMap[item.post_id].push(item);
        });

        const [likes] = await db.execute(
            `SELECT post_id, COUNT(*) as total
             FROM post_likes
             WHERE post_id IN (${placeholders})
             GROUP BY post_id`,
            postIds
        );
        likes.forEach(item => {
            likeCountMap[item.post_id] = item.total;
        });
    }

    return posts.map(post => ({
        ...post,
        media: mediaMap[post.id] || [],
        comments: commentsMap[post.id] || [],
        like_count: likeCountMap[post.id] || 0,
        comment_count: (commentsMap[post.id] || []).length,
        is_archived: true,
        is_liked: false
    }));
}

async function exportArchivedUsers() {
    const [users] = await db.execute(
        `SELECT id, email, full_name, avatar, gender, bio, contact_info, phone, role, status, created_at, last_login
         FROM users
         WHERE role != 'admin'
           AND (
                (last_login IS NULL AND created_at < datetime('now', '-180 days'))
                OR (last_login < datetime('now', '-180 days'))
                OR status = 'banned'
           )
         ORDER BY COALESCE(last_login, created_at) ASC`
    );
    return users.map(user => ({
        ...user,
        is_archived: true
    }));
}

router.get('/share/categories', async (req, res) => {
    try {
        const [productCount] = await db.execute(
            `SELECT COUNT(*) as total FROM products
             WHERE status != 'active'
                OR created_at < datetime('now', '-120 days')`
        );
        const [postCount] = await db.execute(
            `SELECT COUNT(*) as total FROM posts
             WHERE created_at < datetime('now', '-90 days')`
        );
        const [userCount] = await db.execute(
            `SELECT COUNT(*) as total FROM users
             WHERE role != 'admin'
               AND (
                    (last_login IS NULL AND created_at < datetime('now', '-180 days'))
                    OR (last_login < datetime('now', '-180 days'))
                    OR status = 'banned'
               )`
        );

        const counts = {
            products_inactive: productCount[0]?.total || 0,
            posts_old: postCount[0]?.total || 0,
            users_inactive: userCount[0]?.total || 0
        };

        const categories = SHARE_CATEGORIES.map(item => ({
            ...item,
            count: counts[item.key] || 0
        }));

        res.json({ success: true, data: categories });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/share/data/:key', async (req, res) => {
    try {
        const key = req.params.key;
        let data = [];

        if (key === 'products_inactive') {
            data = await exportArchivedProducts();
        } else if (key === 'users_inactive') {
            data = await exportArchivedUsers();
        } else if (key === 'posts_old') {
            data = await exportArchivedPosts();
        } else {
            return res.status(400).json({ success: false, message: 'Invalid category' });
        }

        const currentArchive = await getArchive();
        const mergedArchive = {
            meta: {
                ...(currentArchive.meta || {}),
                last_shared_at: new Date().toISOString(),
                last_shared_key: key
            },
            products: Array.isArray(currentArchive.products) ? currentArchive.products : [],
            posts: Array.isArray(currentArchive.posts) ? currentArchive.posts : []
        };

        if (key === 'products_inactive') {
            mergedArchive.products = mergeById(mergedArchive.products, data);
        }
        if (key === 'users_inactive') {
            mergedArchive.users = mergeById(mergedArchive.users, data);
        }
        if (key === 'posts_old') {
            mergedArchive.posts = mergeById(mergedArchive.posts, data);
        }

        res.json({
            success: true,
            data: mergedArchive
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;


