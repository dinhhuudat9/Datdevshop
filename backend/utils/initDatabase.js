// ============================================
// DATABASE INITIALIZER
// Reads database.sql and bootstrap schema when missing
// ============================================

const fs = require('fs');
const path = require('path');
const db = require('../config/database');

function splitStatements(sql) {
    const statements = [];
    const buffer = [];

    sql.split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--')) return;
        buffer.push(line);
        if (trimmed.endsWith(';')) {
            statements.push(buffer.join('\n'));
            buffer.length = 0;
        }
    });

    return statements
        .map(s => s.trim())
        .filter(Boolean);
}

async function ensureDatabase() {
    // If the users table exists we assume the schema is already created.
    const [tables] = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    if (tables.length > 0) {
        return { created: false };
    }

    const schemaPath = path.join(__dirname, '../../database.sql');
    const sql = fs.readFileSync(schemaPath, 'utf8');
    const statements = splitStatements(sql);

    let executed = 0;
    for (const statement of statements) {
        // Prevent duplicate seed rows when this runs more than once.
        const safeStmt = statement.replace(/^INSERT\s+INTO\s+/i, 'INSERT OR IGNORE INTO ');
        await db.execute(safeStmt);
        executed += 1;
    }

    return { created: true, statements: executed };
}

async function ensureUserFrameColumn() {
    const [columns] = await db.execute("PRAGMA table_info('users')");
    const hasFrame = columns.some(col => col.name === 'frame_url');
    if (!hasFrame) {
        await db.execute("ALTER TABLE users ADD COLUMN frame_url TEXT");
    }
    const hasCover = columns.some(col => col.name === 'cover_image');
    if (!hasCover) {
        await db.execute("ALTER TABLE users ADD COLUMN cover_image TEXT");
    }
}

async function ensureUserSecurityColumns() {
    const [columns] = await db.execute("PRAGMA table_info('users')");
    const hasIsVerified = columns.some(col => col.name === 'is_verified');
    const hasFailedLoginCount = columns.some(col => col.name === 'failed_login_count');
    const hasLastFailedLoginAt = columns.some(col => col.name === 'last_failed_login_at');
    const hasLastFailedLoginIp = columns.some(col => col.name === 'last_failed_login_ip');
    const hasLoginLockedUntil = columns.some(col => col.name === 'login_locked_until');
    const hasRegisterIp = columns.some(col => col.name === 'register_ip');
    const hasLastLoginIp = columns.some(col => col.name === 'last_login_ip');
    const hasSecurityLockReason = columns.some(col => col.name === 'security_lock_reason');
    const hasSecurityLockedIp = columns.some(col => col.name === 'security_locked_ip');
    const hasSecurityLockedAt = columns.some(col => col.name === 'security_locked_at');

    if (!hasIsVerified) {
        await db.execute('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 0');
    }
    if (!hasFailedLoginCount) {
        await db.execute('ALTER TABLE users ADD COLUMN failed_login_count INTEGER DEFAULT 0');
    }
    if (!hasLastFailedLoginAt) {
        await db.execute('ALTER TABLE users ADD COLUMN last_failed_login_at DATETIME');
    }
    if (!hasLastFailedLoginIp) {
        await db.execute('ALTER TABLE users ADD COLUMN last_failed_login_ip TEXT');
    }
    if (!hasLoginLockedUntil) {
        await db.execute('ALTER TABLE users ADD COLUMN login_locked_until DATETIME');
    }
    if (!hasRegisterIp) {
        await db.execute('ALTER TABLE users ADD COLUMN register_ip TEXT');
    }
    if (!hasLastLoginIp) {
        await db.execute('ALTER TABLE users ADD COLUMN last_login_ip TEXT');
    }
    if (!hasSecurityLockReason) {
        await db.execute('ALTER TABLE users ADD COLUMN security_lock_reason TEXT');
    }
    if (!hasSecurityLockedIp) {
        await db.execute('ALTER TABLE users ADD COLUMN security_locked_ip TEXT');
    }
    if (!hasSecurityLockedAt) {
        await db.execute('ALTER TABLE users ADD COLUMN security_locked_at DATETIME');
    }

    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_login_locked_until ON users (login_locked_until)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_register_ip ON users (register_ip)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_last_login_ip ON users (last_login_ip)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_users_security_locked_ip ON users (security_locked_ip)');
}

async function ensureProductReviewsTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS product_reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_product_reviews_product ON product_reviews (product_id)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_product_reviews_user ON product_reviews (user_id)');
    await db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_product_reviews_unique ON product_reviews (product_id, user_id)');

    const [columns] = await db.execute("PRAGMA table_info('product_reviews')");
    const hasRating = columns.some(col => col.name === 'rating');
    const hasComment = columns.some(col => col.name === 'comment');
    const hasCreatedAt = columns.some(col => col.name === 'created_at');
    const hasUpdatedAt = columns.some(col => col.name === 'updated_at');

    if (!hasRating) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN rating INTEGER NOT NULL DEFAULT 5');
    }
    if (!hasComment) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN comment TEXT NOT NULL DEFAULT ""');
    }
    if (!hasCreatedAt) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    }
    if (!hasUpdatedAt) {
        await db.execute('ALTER TABLE product_reviews ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    }
}

async function ensureNotificationColumns() {
    const [columns] = await db.execute("PRAGMA table_info('notifications')");
    const hasImportant = columns.some(col => col.name === 'is_important');
    const hasDismissHours = columns.some(col => col.name === 'dismiss_hours');

    if (!hasImportant) {
        await db.execute('ALTER TABLE notifications ADD COLUMN is_important INTEGER DEFAULT 0');
    }
    if (!hasDismissHours) {
        await db.execute('ALTER TABLE notifications ADD COLUMN dismiss_hours INTEGER DEFAULT 2');
    }
}

async function ensureSecurityTables() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_ip_blocks (
            ip TEXT PRIMARY KEY,
            reason TEXT,
            detail TEXT,
            block_until DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_security_ip_blocks_until ON security_ip_blocks (block_until)');
}

async function ensureSecurityActionLogsTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS security_action_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            action_type TEXT NOT NULL,
            actor_user_id INTEGER,
            actor_ip TEXT,
            target_key TEXT,
            content_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_user ON security_action_logs (action_type, actor_user_id, created_at)'
    );
    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_ip ON security_action_logs (action_type, actor_ip, created_at)'
    );
    await db.execute(
        'CREATE INDEX IF NOT EXISTS idx_security_action_logs_hash ON security_action_logs (action_type, actor_user_id, content_hash, created_at)'
    );
}

async function ensureRegistrationOtpTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS registration_otps (
            email TEXT PRIMARY KEY,
            otp_hash TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            gender TEXT DEFAULT 'male' CHECK (gender IN ('male', 'female', 'other')),
            request_ip TEXT,
            attempt_count INTEGER DEFAULT 0,
            resend_available_at DATETIME,
            expires_at DATETIME NOT NULL,
            last_sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    await db.execute('CREATE INDEX IF NOT EXISTS idx_registration_otps_expires ON registration_otps (expires_at)');
    await db.execute('CREATE INDEX IF NOT EXISTS idx_registration_otps_resend ON registration_otps (resend_available_at)');
}

module.exports = {
    ensureDatabase,
    ensureUserFrameColumn,
    ensureUserSecurityColumns,
    ensureProductReviewsTable,
    ensureNotificationColumns,
    ensureSecurityTables,
    ensureSecurityActionLogsTable,
    ensureRegistrationOtpTable
};
