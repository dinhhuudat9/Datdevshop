// ============================================
// WALLET ROUTES
// File: backend/routes/wallet.routes.js
// ============================================

const { createRouter } = require('../lib/nextHttp');
const router = createRouter();
const { authenticate } = require('../middleware/auth');
const walletController = require('../controllers/walletController');

router.get('/balance', authenticate, async (req, res) => {
    res.json({
        success: true,
        data: { balance: req.user.balance }
    });
});

router.get('/transactions', authenticate, walletController.getTransactions.bind(walletController));
router.get('/deposit-requests', authenticate, walletController.getDepositRequests.bind(walletController));
router.post('/deposit-request', authenticate, walletController.createDepositRequest.bind(walletController));
router.get('/purchases', authenticate, walletController.getPurchases.bind(walletController));

module.exports = router;
