// ============================================
// WALLET CONTROLLER
// File: backend/controllers/walletController.js
// ============================================

const walletService = require('../services/walletService');

class WalletController {
    // GET /api/wallet/transactions
    async getTransactions(req, res) {
        try {
            const result = await walletService.getTransactions(req.user.id, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/wallet/deposit-requests
    async getDepositRequests(req, res) {
        try {
            const rows = await walletService.getDepositRequests(req.user.id);
            res.json({ success: true, data: rows });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // POST /api/wallet/deposit-request
    async createDepositRequest(req, res) {
        try {
            const result = await walletService.createDepositRequest(req.user.id, req.body);
            res.status(201).json({ success: true, message: 'Deposit request created', data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }

    // GET /api/wallet/purchases
    async getPurchases(req, res) {
        try {
            const result = await walletService.getPurchases(req.user.id, req.query);
            res.json({ success: true, data: result });
        } catch (error) {
            res.status(400).json({ success: false, message: error.message });
        }
    }
}

module.exports = new WalletController();
