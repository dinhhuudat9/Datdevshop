// ============================================
// AUTH CONTROLLER
// File: backend/controllers/authController.js
// ============================================

const authService = require('../services/authService');
const geoIpPolicyService = require('../services/geoIpPolicyService');
const logService = require('../services/logService');
const notificationService = require('../services/notificationService');
const recaptchaService = require('../services/recaptchaService');

class AuthController {
    async getRecaptchaConfig(req, res) {
        res.json({
            success: true,
            data: recaptchaService.getPublicConfig(req)
        });
    }

    // POST /api/auth/register
    async register(req, res) {
        try {
            const {
                email,
                password,
                full_name,
                gender,
                terms_acknowledged,
                recaptcha_token,
                otp_code
            } = req.body;
            const clientIp = req.clientIp || req.ip || req.socket?.remoteAddress || '';
            const normalizedOtpCode = String(otp_code || '').trim();
            const isOtpVerification = normalizedOtpCode.length > 0;

            // Validation
            if (!email || (!isOtpVerification && !password)) {
                return res.status(400).json({
                    success: false,
                    message: 'Email and password are required'
                });
            }

            if (!isOtpVerification && password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'Password must be at least 6 characters'
                });
            }

            if (isOtpVerification && !/^\d{4,8}$/.test(normalizedOtpCode)) {
                return res.status(400).json({
                    success: false,
                    message: 'OTP is invalid'
                });
            }

            if (terms_acknowledged !== true) {
                return res.status(400).json({
                    success: false,
                    message: 'Ban phai doc va xac nhan dieu khoan dich vu'
                });
            }

            await geoIpPolicyService.assertVietnamAuthIpAllowed({
                ip: clientIp,
                action: 'auth_register'
            });

            if (!isOtpVerification) {
                await recaptchaService.assertVerified({
                    token: recaptcha_token,
                    ip: clientIp,
                    req,
                    action: 'auth_register'
                });
            }

            const result = await authService.register(email, password, full_name, gender, {
                ip: clientIp,
                otpCode: normalizedOtpCode
            });

            if (result?.otpRequired) {
                return res.json({
                    success: true,
                    message: 'Ma OTP da duoc gui den email cua ban',
                    data: {
                        otp_required: true,
                        email: result.email,
                        expires_in_seconds: result.expiresInSeconds,
                        resend_after_seconds: result.resendAfterSeconds
                    }
                });
            }

            res.cookie('token', result.token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            try {
                const time = new Date().toLocaleString('vi-VN');
                await notificationService.notifyAdmins({
                    title: 'Đăng ký mới',
                    content: `${email} vừa tạo tài khoản lúc ${time}`,
                    created_by: result?.user?.id || null
                }, { sendTelegram: false });
            } catch (err) {
                // ignore notification errors
            }

            res.status(201).json({
                success: true,
                message: 'Registration successful',
                data: result
            });

        } catch (error) {
            if (error.redirectToBlockedIp) {
                if (error.retryAfterSeconds) {
                    res.set('Retry-After', String(error.retryAfterSeconds));
                }
                return res.redirect(302, '/blocked-ip.html');
            }

            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }

            res.status(error.statusCode || 400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/auth/login
    async login(req, res) {
        try {
            const { email, password, terms_acknowledged, recaptcha_token } = req.body;
            const clientIp = req.clientIp || req.ip || req.socket?.remoteAddress || '';

            if (!email || !password) {
                return res.status(400).json({
                    success: false,
                    message: 'Email and password are required'
                });
            }

            if (terms_acknowledged !== true) {
                return res.status(400).json({
                    success: false,
                    message: 'Ban phai doc va xac nhan dieu khoan dich vu'
                });
            }

            await geoIpPolicyService.assertVietnamAuthIpAllowed({
                ip: clientIp,
                action: 'auth_login'
            });

            await recaptchaService.assertVerified({
                token: recaptcha_token,
                ip: clientIp,
                req,
                action: 'auth_login'
            });

            const result = await authService.login(email, password, {
                ip: clientIp
            });

            res.cookie('token', result.token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 7 * 24 * 60 * 60 * 1000
            });

            res.json({
                success: true,
                message: 'Login successful',
                data: result
            });
            logService.recordLogin({ email, userId: result?.user?.id, success: true, ip: clientIp });
            try {
                const user = result?.user;
                const name = user?.full_name || user?.email || email;
                const time = new Date().toLocaleString('vi-VN');
                await notificationService.notifyAdmins({
                    title: 'Đăng nhập',
                    content: `${name} đăng nhập lúc ${time}`,
                    created_by: user?.id || null
                }, { sendTelegram: false });
            } catch (err) {
                // ignore notification errors
            }

        } catch (error) {
            const clientIp = req.clientIp || req.ip || req.socket?.remoteAddress || '';
            logService.recordLogin({ email: req.body?.email, success: false, ip: clientIp });

            if (error.redirectToBlockedIp) {
                if (error.retryAfterSeconds) {
                    res.set('Retry-After', String(error.retryAfterSeconds));
                }
                return res.redirect(302, '/blocked-ip.html');
            }

            if (error.retryAfterSeconds) {
                res.set('Retry-After', String(error.retryAfterSeconds));
            }

            res.status(error.statusCode || 401).json({
                success: false,
                message: error.message
            });
        }
    }

    // GET /api/auth/me
    async getCurrentUser(req, res) {
        try {
            const user = await authService.getCurrentUser(req.user.id);

            res.json({
                success: true,
                data: user
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // PUT /api/auth/update-profile
    async updateProfile(req, res) {
        try {
            const user = await authService.updateProfile(req.user.id, req.body);

            res.json({
                success: true,
                message: 'Profile updated successfully',
                data: user
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // PUT /api/auth/change-password
    async changePassword(req, res) {
        try {
            const { old_password, new_password } = req.body;

            if (!old_password || !new_password) {
                return res.status(400).json({
                    success: false,
                    message: 'Old password and new password are required'
                });
            }

            if (new_password.length < 6) {
                return res.status(400).json({
                    success: false,
                    message: 'New password must be at least 6 characters'
                });
            }

            await authService.changePassword(req.user.id, old_password, new_password);

            res.json({
                success: true,
                message: 'Password changed successfully'
            });

        } catch (error) {
            res.status(400).json({
                success: false,
                message: error.message
            });
        }
    }

    // POST /api/auth/logout
    async logout(req, res) {
        res.clearCookie('token', { httpOnly: true, secure: true, sameSite: 'none' });
        res.json({
            success: true,
            message: 'Logout successful'
        });
    }
}

module.exports = new AuthController();
