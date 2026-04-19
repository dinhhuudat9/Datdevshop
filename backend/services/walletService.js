// ============================================
// WALLET SERVICE
// File: backend/services/walletService.js
// ============================================

const db = require('../config/database');
const { getArchive } = require('./archiveService');

function resolveProductMainImage(mainImage, gallery = []) {
    const direct = (mainImage || '').toString().trim();
    if (direct) return direct;

    for (const item of gallery) {
        const url = item && typeof item.image_url === 'string'
            ? item.image_url.trim()
            : '';
        if (url) return url;
    }

    return null;
}

class WalletService {
    async getTransactions(userId, { page = 1, limit = 20 } = {}) {
        const offset = (page - 1) * limit;

        const [rows] = await db.execute(
            `SELECT id, type, amount, balance_before, balance_after, description, reference_id, created_at
             FROM transactions
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, parseInt(limit, 10), offset]
        );

        const [count] = await db.execute(
            'SELECT COUNT(*) as total FROM transactions WHERE user_id = ?',
            [userId]
        );

        return {
            transactions: rows,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total: count[0].total,
                totalPages: Math.ceil(count[0].total / limit)
            }
        };
    }

    async getDepositRequests(userId) {
        const [rows] = await db.execute(
            `SELECT id, amount, payment_method, payment_proof, status, admin_note, created_at, processed_at
             FROM deposit_requests
             WHERE user_id = ?
             ORDER BY created_at DESC`,
            [userId]
        );

        return rows;
    }

    async createDepositRequest(userId, { amount, payment_method, payment_proof }) {
        if (!amount || amount <= 0) {
            throw new Error('Invalid amount');
        }

        const [result] = await db.execute(
            `INSERT INTO deposit_requests (user_id, amount, payment_method, payment_proof)
             VALUES (?, ?, ?, ?)`,
            [userId, amount, payment_method || null, payment_proof || null]
        );

        return { id: result.insertId };
    }

    async getPurchases(userId, { page = 1, limit = 20 } = {}) {
        const offset = (page - 1) * limit;

        const [rows] = await db.execute(
            `SELECT p.id, p.product_id, p.price_paid, p.download_count, p.last_download, p.created_at,
                    pr.title, pr.slug, pr.main_image, pr.download_url
             FROM purchases p
             LEFT JOIN products pr ON pr.id = p.product_id
             WHERE p.user_id = ?
             ORDER BY p.created_at DESC
             LIMIT ? OFFSET ?`,
            [userId, parseInt(limit, 10), offset]
        );

        const archive = await getArchive();
        const archivedProducts = Array.isArray(archive.products) ? archive.products : [];
        const archivedMap = new Map(
            archivedProducts.map(item => [String(item.id), item])
        );
        const productIds = rows
            .map(row => parseInt(row.product_id, 10))
            .filter(Number.isFinite);
        const galleryMap = {};

        if (productIds.length > 0) {
            const placeholders = productIds.map(() => '?').join(',');
            const [imageRows] = await db.execute(
                `SELECT product_id, image_url, display_order
                 FROM product_images
                 WHERE product_id IN (${placeholders})
                 ORDER BY product_id ASC, display_order ASC, id ASC`,
                productIds
            );
            imageRows.forEach(item => {
                if (!galleryMap[item.product_id]) galleryMap[item.product_id] = [];
                galleryMap[item.product_id].push(item);
            });
        }

        const enriched = rows.map(row => {
            if (row.title) {
                return {
                    ...row,
                    main_image: resolveProductMainImage(row.main_image, galleryMap[row.product_id] || [])
                };
            }
            const archived = archivedMap.get(String(row.product_id));
            if (!archived) return row;
            return {
                ...row,
                title: archived.title,
                slug: archived.slug,
                main_image: resolveProductMainImage(archived.main_image, archived.gallery || []),
                download_url: archived.download_url,
                is_archived: true
            };
        });

        const [count] = await db.execute(
            'SELECT COUNT(*) as total FROM purchases WHERE user_id = ?',
            [userId]
        );

        return {
            purchases: enriched,
            pagination: {
                page: parseInt(page, 10),
                limit: parseInt(limit, 10),
                total: count[0].total,
                totalPages: Math.ceil(count[0].total / limit)
            }
        };
    }
}

module.exports = new WalletService();
