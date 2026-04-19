// ============================================
// TELEGRAM BACKUP SERVICE
// File: backend/services/telegramBackupService.js
// ============================================

const TelegramBot = require('node-telegram-bot-api');
const db = require('../config/database');
const crypto = require('crypto');
const notificationService = require('./notificationService');
const { getArchive } = require('./archiveService');

const PRIMARY_ADMIN_EMAIL = process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com';
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = (process.env.TELEGRAM_ADMIN_CHAT_ID || '').trim();
const ALLOWED_CHAT_IDS = (process.env.TELEGRAM_ALLOWED_CHAT_IDS || ADMIN_CHAT_ID)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

let bot = null;
let backupRunning = false;
let backupQueued = false;
const pendingActions = new Map();
const CONFIRM_TTL_MS = 5 * 60 * 1000;

const MENU_ITEMS = [
    { label: 'Nguoi dung', command: '/nguoidung', table: 'users' },
    { label: 'San pham', command: '/sanpham', table: 'products' },
    { label: 'Danh muc', command: '/danhmuc', table: 'categories' },
    { label: 'Don hang', command: '/donhang', table: 'purchases' },
    { label: 'Giao dich', command: '/giaodich', table: 'transactions' },
    { label: 'Nap tien', command: '/naptiendu', table: 'deposit_requests' },
    { label: 'Bai dang', command: '/baidang', table: 'posts' },
    { label: 'Tin nhan', command: '/tinnhan', table: 'messages' },
    { label: 'Cai dat', command: '/caidat', table: 'system_settings' },
    { label: 'Cong dong', command: '/congdong', table: 'community_messages' },
    { label: 'Ho tro', command: '/hotro', table: 'support_requests' }
];

function isEnabled() {
    return !!BOT_TOKEN && ALLOWED_CHAT_IDS.length > 0;
}

function isAllowedChat(chatId) {
    return ALLOWED_CHAT_IDS.includes(String(chatId));
}

function makeToken() {
    return crypto.randomBytes(16).toString('hex');
}

function addPendingAction(action) {
    const token = makeToken();
    pendingActions.set(token, {
        ...action,
        expires: Date.now() + CONFIRM_TTL_MS
    });
    setTimeout(() => {
        pendingActions.delete(token);
    }, CONFIRM_TTL_MS);
    return token;
}

function getPendingAction(token) {
    const item = pendingActions.get(token);
    if (!item) return null;
    if (Date.now() > item.expires) {
        pendingActions.delete(token);
        return null;
    }
    return item;
}

async function sendConfirm(chatId, title, token) {
    if (!bot) return;
    await bot.sendMessage(chatId, title, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Confirm', callback_data: `confirm:${token}` },
                    { text: 'Cancel', callback_data: `cancel:${token}` }
                ]
            ]
        }
    });
}

function buildMenuText() {
    const lines = MENU_ITEMS.map(item => `${item.command} - ${item.label}`);
    lines.push('/tatca - Xuat toan bo data.json');
    return [
        'Menu du lieu:',
        ...lines
    ].join('\n');
}

function buildInlineKeyboard() {
    const buttons = MENU_ITEMS.map(item => ({
        text: item.label,
        callback_data: `data:${item.table}`
    }));

    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }
    rows.push([{ text: 'Tat ca (data.json)', callback_data: 'data:all' }]);

    return { inline_keyboard: rows };
}

function buildAdminHelp() {
    return [
        'ADMIN COMMANDS',
        '/admin - show this help',
        '/users <keyword?> <page?>',
        '/user <id>',
        '/ban <user_id>',
        '/unban <user_id>',
        '/role <user_id> <user|seller|admin>',
        '/delete_user <user_id>',
        '/products <status?> <page?>',
        '/product <id>',
        '/product_status <id> <active|inactive|banned>',
        '/delete_product <id>',
        '/posts <page?>',
        '/delete_post <id>',
        '/deposits <status?> <page?>',
        '/deposit_approve <id> <note?>',
        '/deposit_reject <id> <note?>',
        '/balance_adjust <user_id> <amount> <description?>',
        '/notify <title> | <content> | <target_email?>',
        '/setting <key> <value>',
        '/revenue_reset',
        '/storage',
        '/share_categories',
        '/share_data <key>',
        '/backup_export',
        '/backup_telegram'
    ].join('\n');
}

async function getTableNames() {
    const [rows] = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    );
    return rows.map(row => row.name);
}

async function exportTable(table) {
    const [rows] = await db.execute(`SELECT * FROM ${table}`);
    return rows;
}

async function exportAll() {
    const tables = await getTableNames();
    const data = {};
    for (const table of tables) {
        data[table] = await exportTable(table);
    }
    return {
        exported_at: new Date().toISOString(),
        primary_admin: PRIMARY_ADMIN_EMAIL,
        data
    };
}

async function sendJson(chatId, filename, payload, options = {}) {
    if (!bot) return;
    const buffer = Buffer.from(JSON.stringify(payload, null, 2));
    await bot.sendDocument(
        chatId,
        buffer,
        { caption: options.caption || filename, disable_notification: !!options.silent },
        { filename, contentType: 'application/json' }
    );
}

async function handleAdminCommand(msg) {
    if (!isAllowedChat(msg.chat.id)) return;
    const text = (msg.text || '').trim();
    const [command, ...rest] = text.split(' ');
    const args = rest.filter(Boolean);
    const chatId = msg.chat.id;

    try {
        if (command === '/admin') {
            await bot.sendMessage(chatId, buildAdminHelp());
            return;
        }

        if (command === '/users') {
            const keyword = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (keyword) {
                where = 'WHERE (email LIKE ? OR full_name LIKE ?)';
                params.push(`%${keyword}%`, `%${keyword}%`);
            }
            const [rows] = await db.execute(
                `SELECT id, email, full_name, role, status, created_at
                 FROM users ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No users found.');
                return;
            }
            const lines = rows.map(u => `#${u.id} ${u.email} ${u.role} ${u.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/user') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /user <id>');
            const [rows] = await db.execute(
                `SELECT id, email, full_name, role, status, balance, created_at, last_login
                 FROM users WHERE id = ?`,
                [userId]
            );
            if (!rows.length) return bot.sendMessage(chatId, 'User not found.');
            const u = rows[0];
            await bot.sendMessage(chatId, JSON.stringify(u, null, 2));
            return;
        }

        if (command === '/ban' || command === '/unban') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /ban <user_id>');
            const status = command === '/ban' ? 'banned' : 'active';
            const token = addPendingAction({
                type: 'user_status',
                payload: { userId, status }
            });
            await sendConfirm(chatId, `Set user ${userId} to ${status}?`, token);
            return;
        }

        if (command === '/role') {
            const userId = parseInt(args[0], 10);
            const role = args[1];
            if (!userId || !role) return bot.sendMessage(chatId, 'Usage: /role <user_id> <user|seller|admin>');
            const token = addPendingAction({
                type: 'user_role',
                payload: { userId, role }
            });
            await sendConfirm(chatId, `Change role of ${userId} to ${role}?`, token);
            return;
        }

        if (command === '/delete_user') {
            const userId = parseInt(args[0], 10);
            if (!userId) return bot.sendMessage(chatId, 'Usage: /delete_user <user_id>');
            const token = addPendingAction({
                type: 'delete_user',
                payload: { userId }
            });
            await sendConfirm(chatId, `Delete user ${userId}?`, token);
            return;
        }

        if (command === '/products') {
            const status = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (status) {
                where = 'WHERE status = ?';
                params.push(status);
            }
            const [rows] = await db.execute(
                `SELECT id, title, status, seller_id, created_at
                 FROM products ${where}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No products found.');
                return;
            }
            const lines = rows.map(p => `#${p.id} ${p.title} ${p.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/product') {
            const productId = args[0];
            if (!productId) return bot.sendMessage(chatId, 'Usage: /product <id>');
            const [rows] = await db.execute(
                `SELECT * FROM products WHERE id = ?`,
                [productId]
            );
            if (!rows.length) return bot.sendMessage(chatId, 'Product not found.');
            await bot.sendMessage(chatId, JSON.stringify(rows[0], null, 2));
            return;
        }

        if (command === '/product_status') {
            const productId = parseInt(args[0], 10);
            const status = args[1];
            if (!productId || !status) return bot.sendMessage(chatId, 'Usage: /product_status <id> <active|inactive|banned>');
            const token = addPendingAction({
                type: 'product_status',
                payload: { productId, status }
            });
            await sendConfirm(chatId, `Set product ${productId} to ${status}?`, token);
            return;
        }

        if (command === '/delete_product') {
            const productId = parseInt(args[0], 10);
            if (!productId) return bot.sendMessage(chatId, 'Usage: /delete_product <id>');
            const token = addPendingAction({
                type: 'delete_product',
                payload: { productId }
            });
            await sendConfirm(chatId, `Delete product ${productId}?`, token);
            return;
        }

        if (command === '/posts') {
            const page = args[0] ? parseInt(args[0], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const [rows] = await db.execute(
                `SELECT id, user_id, content, created_at
                 FROM posts
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No posts found.');
                return;
            }
            const lines = rows.map(p => `#${p.id} user:${p.user_id} ${String(p.content || '').slice(0, 40)}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/delete_post') {
            const postId = parseInt(args[0], 10);
            if (!postId) return bot.sendMessage(chatId, 'Usage: /delete_post <id>');
            const token = addPendingAction({
                type: 'delete_post',
                payload: { postId }
            });
            await sendConfirm(chatId, `Delete post ${postId}?`, token);
            return;
        }

        if (command === '/deposits') {
            const status = args[0] && !/^\d+$/.test(args[0]) ? args[0] : '';
            const page = args[1] ? parseInt(args[1], 10) : 1;
            const limit = 10;
            const offset = (page - 1) * limit;
            const params = [];
            let where = '';
            if (status) {
                where = 'WHERE dr.status = ?';
                params.push(status);
            }
            const [rows] = await db.execute(
                `SELECT dr.id, dr.user_id, dr.amount, dr.status, dr.created_at
                 FROM deposit_requests dr
                 ${where}
                 ORDER BY dr.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );
            if (!rows.length) {
                await bot.sendMessage(chatId, 'No deposit requests found.');
                return;
            }
            const lines = rows.map(r => `#${r.id} user:${r.user_id} ${r.amount} ${r.status}`);
            await bot.sendMessage(chatId, lines.join('\n'));
            return;
        }

        if (command === '/deposit_approve' || command === '/deposit_reject') {
            const requestId = parseInt(args[0], 10);
            if (!requestId) return bot.sendMessage(chatId, 'Usage: /deposit_approve <id> <note?>');
            const note = args.slice(1).join(' ') || '';
            const approve = command === '/deposit_approve';
            const token = addPendingAction({
                type: 'deposit_decision',
                payload: { requestId, approve, note }
            });
            await sendConfirm(chatId, `${approve ? 'Approve' : 'Reject'} deposit ${requestId}?`, token);
            return;
        }

        if (command === '/balance_adjust') {
            const userId = parseInt(args[0], 10);
            const amount = parseFloat(args[1]);
            const description = args.slice(2).join(' ') || '';
            if (!userId || !Number.isFinite(amount)) {
                return bot.sendMessage(chatId, 'Usage: /balance_adjust <user_id> <amount> <description?>');
            }
            const token = addPendingAction({
                type: 'balance_adjust',
                payload: { userId, amount, description }
            });
            await sendConfirm(chatId, `Adjust balance for ${userId} by ${amount}?`, token);
            return;
        }

        if (command === '/notify') {
            const parts = text.replace('/notify', '').split('|').map(s => s.trim()).filter(Boolean);
            if (parts.length < 2) {
                return bot.sendMessage(chatId, 'Usage: /notify <title> | <content> | <target_email?>');
            }
            const [title, content, targetEmail] = parts;
            const token = addPendingAction({
                type: 'notify',
                payload: { title, content, targetEmail }
            });
            await sendConfirm(chatId, 'Send notification?', token);
            return;
        }

        if (command === '/setting') {
            const key = args[0];
            const value = args.slice(1).join(' ');
            if (!key) return bot.sendMessage(chatId, 'Usage: /setting <key> <value>');
            const token = addPendingAction({
                type: 'setting',
                payload: { key, value }
            });
            await sendConfirm(chatId, `Update setting ${key}?`, token);
            return;
        }

        if (command === '/revenue_reset') {
            const token = addPendingAction({ type: 'revenue_reset', payload: {} });
            await sendConfirm(chatId, 'Reset total_revenue to 0?', token);
            return;
        }

        if (command === '/storage') {
            const [userRows] = await db.execute('SELECT COUNT(*) as total FROM users');
            const [productRows] = await db.execute('SELECT COUNT(*) as total FROM products');
            const [postRows] = await db.execute('SELECT COUNT(*) as total FROM posts');
            const [messageRows] = await db.execute('SELECT COUNT(*) as total FROM messages');
            const textOut = [
                `users: ${userRows[0]?.total || 0}`,
                `products: ${productRows[0]?.total || 0}`,
                `posts: ${postRows[0]?.total || 0}`,
                `messages: ${messageRows[0]?.total || 0}`
            ].join('\n');
            await bot.sendMessage(chatId, textOut);
            return;
        }

        if (command === '/share_categories') {
            const archive = await getArchive();
            const categories = [
                { key: 'products_inactive', count: (archive.products || []).length },
                { key: 'users_inactive', count: (archive.users || []).length },
                { key: 'posts_old', count: (archive.posts || []).length }
            ];
            await bot.sendMessage(chatId, JSON.stringify(categories, null, 2));
            return;
        }

        if (command === '/share_data') {
            const key = args[0];
            if (!key) return bot.sendMessage(chatId, 'Usage: /share_data <key>');
            const archive = await getArchive();
            const payload = {
                meta: archive.meta || {},
                products: key === 'products_inactive' ? archive.products || [] : [],
                users: key === 'users_inactive' ? archive.users || [] : [],
                posts: key === 'posts_old' ? archive.posts || [] : []
            };
            return sendJson(chatId, `chiase_${key}.json`, payload, { caption: `chiase_${key}.json` });
        }

        if (command === '/backup_export') {
            const data = await exportAll();
            return sendJson(chatId, 'data.json', data, { caption: 'data.json' });
        }

        if (command === '/backup_telegram') {
            queueFullBackup('telegram', { by: msg.from?.id });
            await bot.sendMessage(chatId, 'Backup queued.');
            return;
        }
    } catch (error) {
        await bot.sendMessage(chatId, `Error: ${error.message}`);
    }
}

async function handleTableRequest(chatId, table) {
    const payload = {
        exported_at: new Date().toISOString(),
        table
    };
    if (table === 'all') {
        payload.data = await exportAll();
        return sendJson(chatId, 'data.json', payload.data, { caption: 'data.json' });
    }

    payload.rows = await exportTable(table);
    return sendJson(chatId, `${table}.json`, payload, { caption: `${table}.json` });
}

function registerCommands() {
    if (!bot) return;

    bot.onText(/\/start|\/data/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        await bot.sendMessage(msg.chat.id, buildMenuText(), {
            reply_markup: buildInlineKeyboard()
        });
    });

    bot.on('callback_query', async (query) => {
        if (!query || !query.data) return;
        if (!isAllowedChat(query.message?.chat?.id)) {
            return bot.answerCallbackQuery(query.id, { text: 'Access denied' });
        }

        const [prefix, value] = query.data.split(':');
        if (prefix === 'data') {
            await bot.answerCallbackQuery(query.id, { text: 'Dang tao du lieu...' });
            try {
                await handleTableRequest(query.message.chat.id, value);
            } catch (error) {
                await bot.sendMessage(query.message.chat.id, `Loi: ${error.message}`);
            }
            return;
        }

        if (prefix === 'confirm') {
            const action = getPendingAction(value);
            if (!action) {
                return bot.answerCallbackQuery(query.id, { text: 'Action expired' });
            }
            pendingActions.delete(value);
            await bot.answerCallbackQuery(query.id, { text: 'Running...' });
            try {
                await runAdminAction(query.message.chat.id, action);
            } catch (error) {
                await bot.sendMessage(query.message.chat.id, `Error: ${error.message}`);
            }
            return;
        }

        if (prefix === 'cancel') {
            pendingActions.delete(value);
            await bot.answerCallbackQuery(query.id, { text: 'Cancelled' });
            return;
        }
    });

    MENU_ITEMS.forEach(item => {
        bot.onText(new RegExp(`\\${item.command}\\b`, 'i'), async (msg) => {
            if (!isAllowedChat(msg.chat.id)) return;
            try {
                await handleTableRequest(msg.chat.id, item.table);
            } catch (error) {
                await bot.sendMessage(msg.chat.id, `Loi: ${error.message}`);
            }
        });
    });

    bot.onText(/\/tatca\b/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        try {
            await handleTableRequest(msg.chat.id, 'all');
        } catch (error) {
            await bot.sendMessage(msg.chat.id, `Loi: ${error.message}`);
        }
    });

    bot.onText(/^\/(admin|users|user|ban|unban|role|delete_user|products|product|product_status|delete_product|posts|delete_post|deposits|deposit_approve|deposit_reject|balance_adjust|notify|setting|revenue_reset|storage|share_categories|share_data|backup_export|backup_telegram)\b/i, async (msg) => {
        if (!isAllowedChat(msg.chat.id)) return;
        await handleAdminCommand(msg);
    });
}

function initTelegramBot() {
    if (!isEnabled()) {
        return;
    }

    bot = new TelegramBot(BOT_TOKEN, { polling: true });
    registerCommands();
    console.log('✅ Telegram backup bot started');
}

async function runAdminAction(chatId, action) {
    const { type, payload } = action;

    if (type === 'user_status') {
        await db.execute('UPDATE users SET status = ? WHERE id = ?', [payload.status, payload.userId]);
        await bot.sendMessage(chatId, 'User status updated.');
        return;
    }

    if (type === 'user_role') {
        await db.execute('UPDATE users SET role = ? WHERE id = ?', [payload.role, payload.userId]);
        await bot.sendMessage(chatId, 'User role updated.');
        return;
    }

    if (type === 'delete_user') {
        await db.execute('DELETE FROM users WHERE id = ?', [payload.userId]);
        await bot.sendMessage(chatId, 'User deleted.');
        return;
    }

    if (type === 'product_status') {
        await db.execute('UPDATE products SET status = ? WHERE id = ?', [payload.status, payload.productId]);
        await bot.sendMessage(chatId, 'Product status updated.');
        return;
    }

    if (type === 'delete_product') {
        await db.execute('DELETE FROM products WHERE id = ?', [payload.productId]);
        await bot.sendMessage(chatId, 'Product deleted.');
        return;
    }

    if (type === 'delete_post') {
        await db.execute('DELETE FROM posts WHERE id = ?', [payload.postId]);
        await bot.sendMessage(chatId, 'Post deleted.');
        return;
    }

    if (type === 'deposit_decision') {
        const connection = await db.getConnection();
        try {
            const { requestId, approve, note } = payload;
            await connection.beginTransaction();

            const [rows] = await connection.execute(
                'SELECT * FROM deposit_requests WHERE id = ?',
                [requestId]
            );
            if (!rows.length) throw new Error('Deposit not found');
            const request = rows[0];
            if (request.status !== 'pending') throw new Error('Already processed');

            const newStatus = approve ? 'approved' : 'rejected';
            await connection.execute(
                `UPDATE deposit_requests
                 SET status = ?, admin_note = ?, processed_at = datetime('now')
                 WHERE id = ?`,
                [newStatus, note || null, requestId]
            );

            if (approve) {
                const amount = parseFloat(request.amount);
                const [users] = await connection.execute(
                    'SELECT balance FROM users WHERE id = ?',
                    [request.user_id]
                );
                if (!users.length) throw new Error('User not found');
                const before = parseFloat(users[0].balance || 0);
                const after = before + amount;
                await connection.execute(
                    'UPDATE users SET balance = ? WHERE id = ?',
                    [after, request.user_id]
                );
                await connection.execute(
                    `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description, reference_id)
                     VALUES (?, 'deposit', ?, ?, ?, ?, ?)`,
                    [request.user_id, amount, before, after, 'Deposit approved', requestId]
                );
            }

            await connection.commit();
            await bot.sendMessage(chatId, `Deposit ${approve ? 'approved' : 'rejected'}.`);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return;
    }

    if (type === 'balance_adjust') {
        const { userId, amount, description } = payload;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );
            if (!users.length) throw new Error('User not found');
            const before = parseFloat(users[0].balance || 0);
            const after = before + parseFloat(amount);
            await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [after, userId]
            );
            await connection.execute(
                `INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, description)
                 VALUES (?, 'admin_adjust', ?, ?, ?, ?)`,
                [userId, amount, before, after, description || 'Admin adjust']
            );
            await connection.commit();
            await bot.sendMessage(chatId, 'Balance updated.');
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
        return;
    }

    if (type === 'notify') {
        const { title, content, targetEmail } = payload;
        let targetId = null;
        if (targetEmail) {
            const [targets] = await db.execute('SELECT id FROM users WHERE email = ?', [targetEmail]);
            if (!targets.length) throw new Error('Target user not found');
            targetId = targets[0].id;
        }
        await notificationService.createNotification({
            title,
            content,
            target_user_id: targetId,
            created_by: null
        });
        await bot.sendMessage(chatId, 'Notification sent.');
        return;
    }

    if (type === 'setting') {
        const { key, value } = payload;
        const [existing] = await db.execute(
            'SELECT id FROM system_settings WHERE setting_key = ?',
            [key]
        );
        if (existing.length) {
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
        await bot.sendMessage(chatId, 'Setting updated.');
        return;
    }

    if (type === 'revenue_reset') {
        await db.execute(
            "UPDATE system_settings SET setting_value = '0' WHERE setting_key = 'total_revenue'"
        );
        await bot.sendMessage(chatId, 'Revenue reset.');
        return;
    }

    await bot.sendMessage(chatId, 'Unknown action.');
}

async function sendTelegramNotification(message) {
    if (!bot || !ADMIN_CHAT_ID) return;
    try {
        await bot.sendMessage(ADMIN_CHAT_ID, message, { disable_notification: false });
    } catch (error) {
        // ignore
    }
}

function queueFullBackup(reason = 'manual', meta = {}) {
    if (!bot || !ADMIN_CHAT_ID) return;

    if (backupRunning) {
        backupQueued = true;
        return;
    }

    backupRunning = true;
    const chatId = ADMIN_CHAT_ID;

    setImmediate(async () => {
        try {
            const payload = await exportAll();
            payload.reason = reason;
            payload.meta = meta;
            await sendJson(chatId, 'data.json', payload, { caption: 'data.json', silent: true });
        } catch (error) {
            try {
                await bot.sendMessage(chatId, `Loi backup: ${error.message}`, { disable_notification: true });
            } catch (err) {
                // ignore
            }
        } finally {
            backupRunning = false;
            if (backupQueued) {
                backupQueued = false;
                queueFullBackup('queued', meta);
            }
        }
    });
}

module.exports = {
    initTelegramBot,
    sendTelegramNotification,
    queueFullBackup,
    exportAll
};
