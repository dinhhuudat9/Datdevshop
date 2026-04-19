// File: frontend/js/pages/register-verify.js
window.pageInit = async function() {
    const PENDING_STORAGE_KEY = 'pending_register_verification_v1';
    const form = document.getElementById('register-verify-form');
    const otpInput = document.getElementById('register-otp-code');
    const otpHint = document.getElementById('register-otp-hint');
    const verifyEmail = document.getElementById('register-verify-email');
    const completeRegisterBtn = document.getElementById('complete-register-btn');
    const resendOtpBtn = document.getElementById('resend-register-otp');
    const editRegisterInfoBtn = document.getElementById('edit-register-info');
    let pendingRegistration = null;

    restorePendingRegistration();
    if (!pendingRegistration?.email) {
        showToast('Khong tim thay phien xac nhan. Hay gui lai ma OTP.', 'error');
        router.navigate('/register');
        return;
    }

    populateVerifyStep();

    otpInput.addEventListener('input', () => {
        otpInput.value = String(otpInput.value || '').replace(/\D/g, '').slice(0, 6);
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();

        const otpCode = String(otpInput.value || '').replace(/\D/g, '').slice(0, 6);
        if (!/^\d{6}$/.test(otpCode)) {
            showToast('Vui long nhap ma OTP gom 6 chu so', 'error');
            return;
        }

        setLoadingState(true);

        try {
            const response = await api.post('/auth/register', {
                email: pendingRegistration.email,
                otp_code: otpCode,
                terms_acknowledged: true
            });

            if (response.success && response.data?.token) {
                clearPendingRegistration();
                Auth.saveAuth(response.data.token, response.data.user);
                if (window.appInstance) {
                    window.appInstance.updateUserSection();
                    window.appInstance.startBalanceSync();
                }
                showToast('Dang ky thanh cong!', 'success');
                setTimeout(() => {
                    router.navigate('/');
                }, 1000);
            }
        } catch (error) {
            showToast(error.message || 'Xac nhan OTP that bai', 'error');
        } finally {
            setLoadingState(false);
        }
    });

    resendOtpBtn.addEventListener('click', () => {
        router.navigate('/register');
        showToast('Quay lai buoc 1 de xac nhan reCAPTCHA va gui lai ma OTP.', 'info');
    });

    editRegisterInfoBtn.addEventListener('click', () => {
        router.navigate('/register');
    });

    function restorePendingRegistration() {
        const raw = sessionStorage.getItem(PENDING_STORAGE_KEY);
        if (!raw) {
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            if (!parsed?.email) {
                sessionStorage.removeItem(PENDING_STORAGE_KEY);
                return;
            }

            pendingRegistration = parsed;
        } catch (_) {
            sessionStorage.removeItem(PENDING_STORAGE_KEY);
        }
    }

    function clearPendingRegistration() {
        pendingRegistration = null;
        sessionStorage.removeItem(PENDING_STORAGE_KEY);
    }

    function populateVerifyStep() {
        verifyEmail.textContent = pendingRegistration.email || '-';
        otpHint.textContent = pendingRegistration.hint || 'Nhap ma OTP vua duoc gui ve email de hoan tat dang ky.';
    }

    function setLoadingState(isLoading) {
        completeRegisterBtn.disabled = isLoading || !pendingRegistration?.email;
        completeRegisterBtn.textContent = isLoading ? 'Dang xac nhan...' : 'Xac nhan va tao tai khoan';
        resendOtpBtn.disabled = isLoading;
        editRegisterInfoBtn.disabled = isLoading;
    }
};
