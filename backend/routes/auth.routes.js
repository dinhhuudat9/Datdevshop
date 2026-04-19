// ============================================
// AUTH ROUTES
// File: backend/routes/auth.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

// Public routes
router.get('/recaptcha-config', authController.getRecaptchaConfig.bind(authController));
router.post('/register', authController.register.bind(authController));
router.post('/login', authController.login.bind(authController));

// Protected routes
router.get('/me', authenticate, authController.getCurrentUser.bind(authController));
router.put('/update-profile', authenticate, authController.updateProfile.bind(authController));
router.put('/change-password', authenticate, authController.changePassword.bind(authController));
router.post('/logout', authenticate, authController.logout.bind(authController));

module.exports = router;
