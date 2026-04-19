// ============================================
// CATEGORY ROUTES
// File: backend/routes/categories.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const categoryController = require('../controllers/categoryController');

router.get('/', categoryController.getCategories.bind(categoryController));

module.exports = router;
