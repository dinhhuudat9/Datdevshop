// ============================================
// PRODUCT SERVICE
// File: backend/services/productService.js
// ============================================

const db = require('../config/database');
const { queueFullBackup } = require('./telegramBackupService');
const { getArchive, purgeArchivedProducts } = require('./archiveService');
const spamProtectionService = require('./spamProtectionService');
const PRIMARY_ADMIN_EMAIL = process.env.PRIMARY_ADMIN_EMAIL || 'duongthithuyhangkupee@gmail.com';

function createStatusError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function parseCategoryIds(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        return input.map(id => parseInt(id, 10)).filter(Number.isFinite);
    }
    if (typeof input === 'string') {
        return input
            .split(',')
            .map(id => parseInt(id.trim(), 10))
            .filter(Number.isFinite);
    }
    return [];
}

function extractImageUrl(item) {
    if (typeof item === 'string') {
        return item.trim();
    }
    if (item && typeof item.image_url === 'string') {
        return item.image_url.trim();
    }
    return '';
}

function resolveProductMainImage(mainImage, gallery = []) {
    const direct = (mainImage || '').toString().trim();
    if (direct) return direct;

    for (const item of gallery) {
        const url = extractImageUrl(item);
        if (url) return url;
    }

    return null;
}

function normalizeArchiveProduct(product = {}) {
    const normalized = { ...product, is_archived: true };
    if (!Array.isArray(normalized.gallery)) normalized.gallery = [];
    normalized.main_image = resolveProductMainImage(normalized.main_image, normalized.gallery);
    if (!Array.isArray(normalized.categories)) {
        if (normalized.category_id) {
            normalized.categories = [{
                id: normalized.category_id,
                name: normalized.category_name,
                slug: normalized.category_slug
            }].filter(item => item.id);
        } else {
            normalized.categories = [];
        }
    }
    return normalized;
}

function filterProductsByOptions(products, options = {}) {
    const {
        category_id,
        category_ids,
        seller_id,
        search,
        status
    } = options;

    const categoryList = parseCategoryIds(category_ids);
    const statusValue = status ? String(status) : null;
    const searchText = search ? String(search).toLowerCase() : '';

    return products.filter(product => {
        if (statusValue && product.status !== statusValue) return false;
        if (seller_id && Number(product.seller_id) !== Number(seller_id)) return false;

        if (category_id) {
            const cid = Number(category_id);
            const categories = Array.isArray(product.categories) ? product.categories : [];
            const inPrimary = Number(product.category_id) === cid;
            const inList = categories.some(c => Number(c.id) === cid);
            if (!inPrimary && !inList) return false;
        }

        if (categoryList.length) {
            const categories = Array.isArray(product.categories) ? product.categories : [];
            const primaryMatch = categoryList.includes(Number(product.category_id));
            const listMatch = categories.some(c => categoryList.includes(Number(c.id)));
            if (!primaryMatch && !listMatch) return false;
        }

        if (searchText) {
            const title = (product.title || '').toString().toLowerCase();
            const description = (product.description || '').toString().toLowerCase();
            if (!title.includes(searchText) && !description.includes(searchText)) return false;
        }

        return true;
    });
}

function sortProducts(items = [], sort = 'newest') {
    const data = [...items];
    if (sort === 'price_asc') {
        data.sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
        return data;
    }
    if (sort === 'price_desc') {
        data.sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
        return data;
    }
    if (sort === 'popular') {
        data.sort((a, b) => {
            const aScore = Number(a.purchase_count || 0) * 2 + Number(a.view_count || 0);
            const bScore = Number(b.purchase_count || 0) * 2 + Number(b.view_count || 0);
            if (bScore !== aScore) return bScore - aScore;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });
        return data;
    }
    data.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return data;
}

async function getReviewStatsByProductIds(productIds = []) {
    if (!Array.isArray(productIds) || productIds.length === 0) return {};

    const placeholders = productIds.map(() => '?').join(',');
    const [rows] = await db.execute(
        `SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as review_count
         FROM product_reviews
         WHERE product_id IN (${placeholders})
         GROUP BY product_id`,
        productIds
    );

    const map = {};
    rows.forEach(item => {
        map[item.product_id] = {
            avg_rating: Number(item.avg_rating || 0),
            review_count: Number(item.review_count || 0)
        };
    });
    return map;
}

async function getUserEmailById(userId) {
    const [rows] = await db.execute(
        'SELECT email FROM users WHERE id = ?',
        [userId]
    );
    return rows[0]?.email || null;
}

async function resolveLiveProductByIdentifier(productIdentifier, executor = db) {
    const [rows] = await executor.execute(
        `SELECT id, seller_id, title, slug, status, price
         FROM products
         WHERE id = ? OR slug = ?
         LIMIT 1`,
        [productIdentifier, productIdentifier]
    );
    return rows[0] || null;
}

class ProductService {
    async getPurchaseTarget(productIdentifier) {
        const product = await resolveLiveProductByIdentifier(productIdentifier);
        if (!product) {
            throw createStatusError('Product not found', 404);
        }

        return product;
    }
    // Lấy danh sách sản phẩm với phân trang và filter
    async getProducts(options = {}) {
        try {
            const {
                page = 1,
                limit = 10,
                sort = 'newest'
            } = options;

            const normalizedOptions = {
                ...options,
                status: options.status ?? 'active'
            };

            const archive = await getArchive();
            const archivedProducts = Array.isArray(archive.products) ? archive.products : [];

            await purgeArchivedProducts(archivedProducts.map(p => p.id).filter(Boolean));

            const [dbProducts] = await db.execute(
                `SELECT 
                    p.*,
                    c.name as category_name,
                    c.slug as category_slug,
                    u.full_name as seller_name,
                    u.avatar as seller_avatar,
                    u.gender as seller_gender,
                    u.is_verified as seller_is_verified
                 FROM products p
                 LEFT JOIN categories c ON p.category_id = c.id
                 LEFT JOIN users u ON p.seller_id = u.id`
            );

            const productIds = dbProducts.map(p => p.id);
            const categoriesMap = {};
            const imagesMap = {};
            if (productIds.length > 0) {
                const placeholders = productIds.map(() => '?').join(',');
                const [catRows] = await db.execute(
                    `SELECT pc.product_id, c.id, c.name, c.slug
                     FROM product_categories pc
                     JOIN categories c ON c.id = pc.category_id
                     WHERE pc.product_id IN (${placeholders})`,
                    productIds
                );
                catRows.forEach(item => {
                    if (!categoriesMap[item.product_id]) categoriesMap[item.product_id] = [];
                    categoriesMap[item.product_id].push({
                        id: item.id,
                        name: item.name,
                        slug: item.slug
                    });
                });

                const [imageRows] = await db.execute(
                    `SELECT * FROM product_images
                     WHERE product_id IN (${placeholders})
                     ORDER BY product_id ASC, display_order ASC, id ASC`,
                    productIds
                );
                imageRows.forEach(item => {
                    if (!imagesMap[item.product_id]) imagesMap[item.product_id] = [];
                    imagesMap[item.product_id].push(item);
                });
            }

            // Review stats
            const reviewStatsMap = await getReviewStatsByProductIds(productIds);

            const archivedIds = new Set(archivedProducts.map(p => String(p.id)));
            const liveProducts = dbProducts
                .filter(p => !archivedIds.has(String(p.id)))
                .map(p => {
                    const gallery = imagesMap[p.id] || [];
                    const mainImage = resolveProductMainImage(p.main_image, gallery);
                    return {
                    ...p,
                    main_image: mainImage,
                    gallery,
                    categories: categoriesMap[p.id] || (p.category_id ? [{
                        id: p.category_id,
                        name: p.category_name,
                        slug: p.category_slug
                    }] : []),
                    is_archived: false,
                    avg_rating: reviewStatsMap[p.id]?.avg_rating || 0,
                    review_count: reviewStatsMap[p.id]?.review_count || 0
                    };
                });

            const archiveList = archivedProducts.map(normalizeArchiveProduct);

            const filtered = filterProductsByOptions(
                [...liveProducts, ...archiveList],
                normalizedOptions
            );

            const sorted = sortProducts(filtered, sort);
            const safeLimit = Math.max(parseInt(limit, 10) || 10, 1);
            const safePage = Math.max(parseInt(page, 10) || 1, 1);
            const offset = (safePage - 1) * safeLimit;
            const paged = sorted.slice(offset, offset + safeLimit);
            const total = sorted.length;
            const totalPages = Math.ceil(total / safeLimit);

            return {
                products: paged,
                pagination: {
                    page: safePage,
                    limit: safeLimit,
                    total,
                    totalPages
                }
            };

        } catch (error) {
            throw error;
        }
    }

    // Lấy chi tiết sản phẩm
    async getProductById(productIdentifier, userId = null) {
        try {
            const archive = await getArchive();
            const archivedProducts = Array.isArray(archive.products) ? archive.products : [];
            await purgeArchivedProducts(archivedProducts.map(p => p.id).filter(Boolean));

            const archivedMatch = archivedProducts.find(item =>
                String(item.id) === String(productIdentifier) ||
                String(item.slug || '') === String(productIdentifier)
            );

            if (archivedMatch) {
                const product = normalizeArchiveProduct(archivedMatch);
                product.is_purchased = false;

                if (userId && product.id) {
                    const [purchases] = await db.execute(
                        'SELECT id FROM purchases WHERE user_id = ? AND product_id = ?',
                        [userId, product.id]
                    );
                    product.is_purchased = purchases.length > 0;
                }

                return product;
            }

            // Get product
            const [products] = await db.execute(`
                SELECT 
                    p.*,
                    c.name as category_name,
                    c.slug as category_slug,
                    u.id as seller_id,
                    u.full_name as seller_name,
                    u.avatar as seller_avatar,
                    u.gender as seller_gender,
                    u.email as seller_email,
                    u.is_verified as seller_is_verified
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN users u ON p.seller_id = u.id
                WHERE p.id = ? OR p.slug = ?
            `, [productIdentifier, productIdentifier]);

            if (products.length === 0 && /^[0-9]+$/.test(String(productIdentifier))) {
                const [fallback] = await db.execute(`
                    SELECT 
                    p.*,
                    c.name as category_name,
                    c.slug as category_slug,
                    u.id as seller_id,
                    u.full_name as seller_name,
                    u.avatar as seller_avatar,
                    u.gender as seller_gender,
                    u.email as seller_email,
                    u.is_verified as seller_is_verified
                    FROM products p
                    LEFT JOIN categories c ON p.category_id = c.id
                    LEFT JOIN users u ON p.seller_id = u.id
                    WHERE p.id = ?
                `, [productIdentifier]);
                if (fallback.length > 0) {
                    products.push(fallback[0]);
                }
            }

            if (products.length === 0) {
                throw new Error('Product not found');
            }

            const product = products[0];
            const productId = product.id;

            // Review stats
            const [reviewRows] = await db.execute(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
                 FROM product_reviews
                 WHERE product_id = ?`,
                [productId]
            );
            product.avg_rating = Number(reviewRows[0]?.avg_rating || 0);
            product.review_count = Number(reviewRows[0]?.review_count || 0);

            // User review (if any)
            if (userId) {
                const [myReviewRows] = await db.execute(
                    'SELECT id, rating, comment, created_at, updated_at FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
                    [productId, userId]
                );
                product.my_review = myReviewRows[0] || null;
            }

            // Get gallery images
            const [images] = await db.execute(
                'SELECT * FROM product_images WHERE product_id = ? ORDER BY display_order',
                [productId]
            );

            product.gallery = images;
            product.main_image = resolveProductMainImage(product.main_image, images);

            // Get categories
            const [categories] = await db.execute(
                `SELECT c.id, c.name, c.slug
                 FROM product_categories pc
                 JOIN categories c ON c.id = pc.category_id
                 WHERE pc.product_id = ?`,
                [productId]
            );

            if (categories.length > 0) {
                product.categories = categories;
            } else if (product.category_id) {
                product.categories = [{
                    id: product.category_id,
                    name: product.category_name,
                    slug: product.category_slug
                }];
            } else {
                product.categories = [];
            }

            // Check if user purchased
            if (userId) {
                const [purchases] = await db.execute(
                    'SELECT id FROM purchases WHERE user_id = ? AND product_id = ?',
                    [userId, productId]
                );
                product.is_purchased = purchases.length > 0;
            }

            // Increment view count
            await db.execute(
                'UPDATE products SET view_count = view_count + 1 WHERE id = ?',
                [productId]
            );

            return product;

        } catch (error) {
            throw error;
        }
    }

    // Tạo sản phẩm mới
    async getProductReviews(productIdentifier, userId = null) {
        try {
            const product = await resolveLiveProductByIdentifier(productIdentifier);
            if (!product) {
                throw new Error('Product not found');
            }

            const [reviews] = await db.execute(
                `SELECT 
                    r.id,
                    r.product_id,
                    r.user_id,
                    r.rating,
                    r.comment,
                    r.created_at,
                    r.updated_at,
                    u.full_name,
                    u.avatar,
                    u.gender,
                    u.is_verified
                 FROM product_reviews r
                 LEFT JOIN users u ON u.id = r.user_id
                 WHERE r.product_id = ?
                 ORDER BY r.updated_at DESC, r.created_at DESC`,
                [product.id]
            );

            const [statsRows] = await db.execute(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
                 FROM product_reviews
                 WHERE product_id = ?`,
                [product.id]
            );

            let canReview = false;
            let reviewReason = null;
            let myReview = null;

            if (userId) {
                myReview = reviews.find(item => Number(item.user_id) === Number(userId)) || null;

                if (Number(userId) === Number(product.seller_id)) {
                    reviewReason = 'Bạn không thể đánh giá sản phẩm của chính mình';
                } else {
                    const [purchaseRows] = await db.execute(
                        'SELECT id FROM purchases WHERE user_id = ? AND product_id = ? LIMIT 1',
                        [userId, product.id]
                    );
                    canReview = purchaseRows.length > 0;
                    if (!canReview) {
                        reviewReason = 'Bạn cần mua sản phẩm trước khi đánh giá';
                    }
                }
            } else {
                reviewReason = 'Vui lòng đăng nhập để gửi đánh giá';
            }

            return {
                product_id: product.id,
                avg_rating: Number(statsRows[0]?.avg_rating || 0),
                review_count: Number(statsRows[0]?.review_count || 0),
                can_review: canReview,
                review_reason: reviewReason,
                my_review: myReview ? {
                    id: myReview.id,
                    rating: myReview.rating,
                    comment: myReview.comment,
                    created_at: myReview.created_at,
                    updated_at: myReview.updated_at
                } : null,
                reviews
            };
        } catch (error) {
            throw error;
        }
    }

    async upsertProductReview(productIdentifier, userId, { rating, comment }) {
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            const product = await resolveLiveProductByIdentifier(productIdentifier, connection);
            if (!product) {
                throw new Error('Product not found');
            }

            if (Number(userId) === Number(product.seller_id)) {
                throw new Error('Bạn không thể đánh giá sản phẩm của chính mình');
            }

            const parsedRating = Number.parseInt(rating, 10);
            if (!Number.isFinite(parsedRating) || parsedRating < 1 || parsedRating > 5) {
                throw new Error('Số sao đánh giá phải từ 1 đến 5');
            }

            const safeComment = (comment || '').toString().trim();
            if (!safeComment) {
                throw new Error('Vui lòng nhập mô tả đánh giá');
            }

            const [purchases] = await connection.execute(
                'SELECT id FROM purchases WHERE user_id = ? AND product_id = ? LIMIT 1',
                [userId, product.id]
            );
            if (purchases.length === 0) {
                throw new Error('Bạn cần mua sản phẩm trước khi đánh giá');
            }

            const [existing] = await connection.execute(
                'SELECT id FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
                [product.id, userId]
            );

            if (existing.length > 0) {
                await connection.execute(
                    `UPDATE product_reviews
                     SET rating = ?, comment = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [parsedRating, safeComment, existing[0].id]
                );
            } else {
                await connection.execute(
                    `INSERT INTO product_reviews (product_id, user_id, rating, comment)
                     VALUES (?, ?, ?, ?)`,
                    [product.id, userId, parsedRating, safeComment]
                );
            }

            const [reviewRows] = await connection.execute(
                'SELECT id, rating, comment, created_at, updated_at FROM product_reviews WHERE product_id = ? AND user_id = ? LIMIT 1',
                [product.id, userId]
            );

            const [statsRows] = await connection.execute(
                `SELECT AVG(rating) as avg_rating, COUNT(*) as review_count
                 FROM product_reviews
                 WHERE product_id = ?`,
                [product.id]
            );

            await connection.commit();

            return {
                review: reviewRows[0] || null,
                avg_rating: Number(statsRows[0]?.avg_rating || 0),
                review_count: Number(statsRows[0]?.review_count || 0)
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async deleteProductReview(productIdentifier, reviewId, requesterId, requesterRole = 'user') {
        try {
            const product = await resolveLiveProductByIdentifier(productIdentifier);
            if (!product) {
                throw createStatusError('Product not found', 404);
            }

            const [rows] = await db.execute(
                `SELECT id, user_id
                 FROM product_reviews
                 WHERE id = ? AND product_id = ?
                 LIMIT 1`,
                [reviewId, product.id]
            );

            if (!rows.length) {
                throw createStatusError('Review not found', 404);
            }

            const review = rows[0];
            const canDelete = requesterRole === 'admin'
                || Number(review.user_id) === Number(requesterId)
                || Number(product.seller_id) === Number(requesterId);

            if (!canDelete) {
                throw createStatusError('You do not have permission to delete this review', 403);
            }

            await db.execute(
                'DELETE FROM product_reviews WHERE id = ? AND product_id = ?',
                [reviewId, product.id]
            );

            return true;
        } catch (error) {
            throw error;
        }
    }

    async createProduct(sellerId, productData) {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            const {
                title,
                slug,
                description,
                content,
                price,
                category_id,
                category_ids,
                main_image,
                background_image,
                video_url,
                demo_url,
                download_url,
                gallery = []
            } = productData;

            const safeDescription = description ?? null;
            const safeContent = content ?? null;
            const safeBackgroundImage = background_image ?? null;
            const safeVideoUrl = video_url ?? null;
            const safeDemoUrl = demo_url ?? null;
            const safeDownloadUrl = download_url ?? null;
            const safeGallery = [...new Set(
                (Array.isArray(gallery) ? gallery : [])
                    .map(item => (item || '').toString().trim())
                    .filter(Boolean)
            )];
            const safeMainImage = resolveProductMainImage(main_image, safeGallery);
            const rawCategoryIds = Array.isArray(category_ids) && category_ids.length
                ? category_ids.filter(Boolean)
                : (category_id ? [category_id] : []);
            const safeCategoryIds = [...new Set(rawCategoryIds)];
            const safeSlug = (slug && slug.trim().length)
                ? slug.trim()
                : (title || '').toLowerCase()
                    .normalize('NFD')
                    .replace(/[\u0300-\u036f]/g, '')
                    .replace(/đ/g, 'd')
                    .replace(/[^\w\s-]/g, '')
                    .replace(/\s+/g, '-')
                    .replace(/-+/g, '-')
                    .trim();
            const primaryCategoryId = safeCategoryIds[0] ?? category_id;

            if (!primaryCategoryId) {
                throw new Error('Category is required');
            }
            if (!safeMainImage) {
                throw new Error('Main image is required');
            }

            // Insert product
            const [result] = await connection.execute(
                `INSERT INTO products 
                (title, slug, description, content, price, category_id, seller_id, 
                main_image, background_image, video_url, demo_url, download_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [title, safeSlug, safeDescription, safeContent, price, primaryCategoryId, sellerId,
                 safeMainImage, safeBackgroundImage, safeVideoUrl, safeDemoUrl, safeDownloadUrl]
            );

            const productId = result.insertId;

            // Insert gallery images
            if (safeGallery.length > 0) {
                for (let i = 0; i < safeGallery.length; i++) {
                    await connection.execute(
                        'INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)',
                        [productId, safeGallery[i], i]
                    );
                }
            }

            // Insert product categories
            if (safeCategoryIds.length > 0) {
                for (const catId of safeCategoryIds) {
                    await connection.execute(
                        'INSERT INTO product_categories (product_id, category_id) VALUES (?, ?)',
                        [productId, catId]
                    );
                }
            }

            await connection.commit();

            return await this.getProductById(productId);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Cập nhật sản phẩm
    async updateProduct(productId, userId, userRole, productData) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            // Check ownership
            const [products] = await connection.execute(
                `SELECT p.seller_id, u.email as seller_email
                 FROM products p
                 JOIN users u ON u.id = p.seller_id
                 WHERE p.id = ?`,
                [productId]
            );

            if (products.length === 0) {
                throw new Error('Product not found');
            }

            const requesterEmail = await getUserEmailById(userId);
            if (products[0].seller_email === PRIMARY_ADMIN_EMAIL && requesterEmail !== PRIMARY_ADMIN_EMAIL) {
                throw new Error('Không thể chỉnh sửa sản phẩm của admin chính');
            }

            if (userRole !== 'admin' && products[0].seller_id !== userId) {
                throw new Error('You do not have permission to edit this product');
            }

            const updates = [];
            const values = [];
            const hasGallery = Object.prototype.hasOwnProperty.call(productData, 'gallery');
            const safeGallery = hasGallery
                ? [...new Set(
                    (Array.isArray(productData.gallery) ? productData.gallery : [])
                        .map(item => (item || '').toString().trim())
                        .filter(Boolean)
                )]
                : [];

            const fields = ['title', 'slug', 'description', 'content', 'price', 'category_id',
                           'main_image', 'background_image', 'video_url', 'demo_url', 'download_url', 'status'];

            fields.forEach(field => {
                if (productData[field] !== undefined) {
                    updates.push(`${field} = ?`);
                    values.push(productData[field]);
                }
            });

            if (updates.length === 0 && !hasGallery) {
                throw new Error('No data to update');
            }

            if (updates.length > 0) {
                values.push(productId);

                await connection.execute(
                    `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
                    values
                );
            }

            if (hasGallery) {
                await connection.execute(
                    'DELETE FROM product_images WHERE product_id = ?',
                    [productId]
                );

                for (let i = 0; i < safeGallery.length; i++) {
                    await connection.execute(
                        'INSERT INTO product_images (product_id, image_url, display_order) VALUES (?, ?, ?)',
                        [productId, safeGallery[i], i]
                    );
                }
            }

            await connection.commit();

            return await this.getProductById(productId);

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    // Xóa sản phẩm
    async deleteProduct(productId, userId, userRole) {
        try {
            // Check ownership
            const [products] = await db.execute(
                `SELECT p.seller_id, u.email as seller_email
                 FROM products p
                 JOIN users u ON u.id = p.seller_id
                 WHERE p.id = ?`,
                [productId]
            );

            if (products.length === 0) {
                throw new Error('Product not found');
            }

            const requesterEmail = await getUserEmailById(userId);
            if (products[0].seller_email === PRIMARY_ADMIN_EMAIL && requesterEmail !== PRIMARY_ADMIN_EMAIL) {
                throw new Error('Không thể xóa sản phẩm của admin chính');
            }

            if (userRole !== 'admin' && products[0].seller_id !== userId) {
                throw new Error('You do not have permission to delete this product');
            }

            await db.execute('DELETE FROM products WHERE id = ?', [productId]);

            return true;

        } catch (error) {
            throw error;
        }
    }

    // Mua sản phẩm
    async purchaseProduct(userId, productId, context = {}) {
        const connection = await db.getConnection();
        
        try {
            await connection.beginTransaction();

            let resolvedProductId = productId;
            if (!/^\d+$/.test(String(productId))) {
                const [bySlug] = await connection.execute(
                    'SELECT id FROM products WHERE slug = ?',
                    [productId]
                );
                if (bySlug.length === 0) {
                    throw new Error('Product not found');
                }
                resolvedProductId = bySlug[0].id;
            }

            // Check if already purchased
            const [existing] = await connection.execute(
                'SELECT id FROM purchases WHERE user_id = ? AND product_id = ?',
                [userId, resolvedProductId]
            );

            if (existing.length > 0) {
                throw new Error('You have already purchased this product');
            }

            // Get product and user
            const [products] = await connection.execute(
                'SELECT id, title, price, seller_id, status FROM products WHERE id = ?',
                [resolvedProductId]
            );

            if (products.length === 0) {
                throw new Error('Product not found');
            }

            const product = products[0];

            if (product.status !== 'active') {
                throw new Error('Product is not available');
            }

            // Ngăn người bán tự mua sản phẩm của mình (tránh vòng trừ rồi cộng lại)
            if (Number(product.seller_id) === Number(userId)) {
                throw new Error('Bạn không thể mua sản phẩm của chính mình');
            }

            const [users] = await connection.execute(
                'SELECT balance FROM users WHERE id = ?',
                [userId]
            );

            const user = users[0];

            if (Number(product.price || 0) <= 0) {
                await spamProtectionService.guardFreePurchase(connection, {
                    userId,
                    ip: context.ip || '',
                    productId: resolvedProductId
                });
            }

            // Check balance
            if (user.balance < product.price) {
                throw new Error('Insufficient balance');
            }

            // Deduct balance
            const newBalance = user.balance - product.price;

            await connection.execute(
                'UPDATE users SET balance = ? WHERE id = ?',
                [newBalance, userId]
            );

            // Add to seller balance
            await connection.execute(
                'UPDATE users SET balance = balance + ? WHERE id = ?',
                [product.price, product.seller_id]
            );

            // Create purchase record
            await connection.execute(
                'INSERT INTO purchases (user_id, product_id, price_paid) VALUES (?, ?, ?)',
                [userId, resolvedProductId, product.price]
            );

            // Create transaction record
            await connection.execute(
                `INSERT INTO transactions 
                (user_id, type, amount, balance_before, balance_after, description, reference_id)
                VALUES (?, 'purchase', ?, ?, ?, ?, ?)`,
                [userId, -product.price, user.balance, newBalance, `Purchase: ${product.title}`, resolvedProductId]
            );

            // Update product purchase count
            await connection.execute(
                'UPDATE products SET purchase_count = purchase_count + 1 WHERE id = ?',
                [resolvedProductId]
            );

            // Update system revenue
            await connection.execute(
                `UPDATE system_settings 
                SET setting_value = CAST(setting_value AS REAL) + ? 
                WHERE setting_key = 'total_revenue'`,
                [product.price]
            );

            await connection.commit();

            queueFullBackup('purchase', { user_id: userId, product_id: resolvedProductId });

            return {
                success: true,
                newBalance,
                product: {
                    id: resolvedProductId,
                    title: product.title,
                    price: product.price,
                    seller_id: product.seller_id
                }
            };

        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = new ProductService();
