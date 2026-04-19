const bcrypt = require('bcrypt');
const db = require('./config/database');
const { initTelegramBot } = require('./services/telegramBackupService');
const {
    ensureDatabase,
    ensureUserFrameColumn,
    ensureUserSecurityColumns,
    ensureProductReviewsTable,
    ensureNotificationColumns,
    ensureSecurityTables,
    ensureSecurityActionLogsTable,
    ensureRegistrationOtpTable
} = require('./utils/initDatabase');

const bootstrapState = global.__sourceMarketBootstrapState || (global.__sourceMarketBootstrapState = {
    done: false,
    promise: null,
    telegramStarted: false
});

async function createDefaultAdmin() {
    try {
        const adminEmail = process.env.ADMIN_EMAIL || 'nguyenhongsang0207@gmail.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123456';

        const [existing] = await db.execute(
            'SELECT id FROM users WHERE email = ?',
            [adminEmail]
        );

        if (existing.length === 0) {
            const passwordHash = await bcrypt.hash(adminPassword, 10);
            await db.execute(
                'INSERT INTO users (email, password_hash, full_name, role, is_verified) VALUES (?, ?, ?, ?, ?)',
                [adminEmail, passwordHash, 'System Admin', 'admin', 1]
            );
            console.log('Default admin account created');
        } else {
            await db.execute(
                'UPDATE users SET is_verified = 1 WHERE email = ?',
                [adminEmail]
            );
        }
    } catch (error) {
        console.error('Error creating admin account:', error.message);
    }
}

async function runBootstrap() {
    const initResult = await ensureDatabase();
    if (initResult.created) {
        console.log(`Database initialized (${initResult.statements} statements applied)`);
    }

    await ensureUserFrameColumn();
    await ensureUserSecurityColumns();
    await ensureProductReviewsTable();
    await ensureNotificationColumns();
    await ensureSecurityTables();
    await ensureSecurityActionLogsTable();
    await ensureRegistrationOtpTable();
    await createDefaultAdmin();

    if (!bootstrapState.telegramStarted) {
        initTelegramBot();
        bootstrapState.telegramStarted = true;
    }

    bootstrapState.done = true;
}

async function ensureBootstrapped() {
    if (bootstrapState.done) {
        return;
    }

    if (!bootstrapState.promise) {
        bootstrapState.promise = runBootstrap().catch((error) => {
            bootstrapState.promise = null;
            throw error;
        });
    }

    await bootstrapState.promise;
}

module.exports = {
    ensureBootstrapped
};
