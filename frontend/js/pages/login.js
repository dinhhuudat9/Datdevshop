// ============================================
// LOGIN PAGE SCRIPT
// File: frontend/js/pages/login.js
// ============================================

window.pageInit = async function(params, query) {
    const form = document.getElementById('login-form');
    const tosOpen = document.getElementById('tos-open');
    const tosModal = document.getElementById('tos-modal');
    const tosClose = document.getElementById('tos-close');
    const tosConfirm = document.getElementById('tos-confirm');
    const tosTitle = document.getElementById('tos-title');
    const tosContent = document.getElementById('tos-content');
    const tosStatus = document.getElementById('tos-status');
    const recaptchaContainer = document.getElementById('login-recaptcha');
    const submitBtn = form.querySelector('button[type="submit"]');
    let hasReadTerms = false;
    let canSubmitAuthForm = false;
    let recaptchaState = { enabled: false, widgetId: null };

    window.PublicIpManager?.warmup?.();
    await loadTerms();
    bindTermsModal();
    updateTermsState();
    await initRecaptcha();

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const email = formData.get('email');
        const password = formData.get('password');

        // Validation
        if (!email || !password) {
            showToast('Vui lòng nhập đầy đủ thông tin', 'error');
            return;
        }

        if (!isValidEmail(email)) {
            showToast('Email không hợp lệ', 'error');
            return;
        }

        if (!hasReadTerms) {
            showToast('Bạn phải mở điều khoản và bấm "Đã đọc" trước khi đăng nhập', 'error');
            openTermsModal();
            return;
        }

        const recaptchaToken = recaptchaState.enabled
            ? window.RecaptchaManager.getResponse(recaptchaState.widgetId)
            : '';

        if (recaptchaState.enabled && !recaptchaToken) {
            showToast('Vui lòng xác nhận reCAPTCHA', 'error');
            return;
        }

        // Disable button
        submitBtn.disabled = true;
        submitBtn.textContent = 'Đang đăng nhập...';

        try {
            const response = await api.post('/auth/login', {
                email,
                password,
                terms_acknowledged: true,
                recaptcha_token: recaptchaToken
            });

            if (response.success) {
                // Save auth
                Auth.saveAuth(response.data.token, response.data.user);

                if (window.appInstance) {
                    window.appInstance.updateUserSection();
                    window.appInstance.startBalanceSync();
                }

                showToast('Đăng nhập thành công!', 'success');

                // Redirect
                setTimeout(() => {
                    const redirect = query.redirect || '/';
                    router.navigate(redirect);
                }, 1000);
            }

        } catch (error) {
            if (recaptchaState.enabled) {
                window.RecaptchaManager.reset(recaptchaState.widgetId);
            }
            showToast(error.message || 'Đăng nhập thất bại', 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Đăng nhập';
        }
    });

    async function loadTerms() {
        if (!tosTitle || !tosContent) return;
        try {
            const res = await api.get('/settings', { keys: 'tos_title,tos_content' });
            if (!res.success) return;
            const title = res.data.tos_title || 'Điều khoản dịch vụ';
            const content = res.data.tos_content || '';
            tosTitle.textContent = title;
            tosContent.innerHTML = content
                ? content.split('\n').map(line => `<p>${line}</p>`).join('')
                : '<p>Chưa có nội dung điều khoản.</p>';
        } catch (error) {
            tosContent.innerHTML = '<p>Không thể tải điều khoản.</p>';
        }
    }

    function bindTermsModal() {
        if (tosOpen && tosModal) {
            tosOpen.addEventListener('click', () => openTermsModal());
        }
        if (tosClose && tosModal) {
            tosClose.addEventListener('click', () => tosModal.classList.remove('active'));
        }
        if (tosConfirm && tosModal) {
            tosConfirm.addEventListener('click', () => {
                hasReadTerms = true;
                updateTermsState();
                tosModal.classList.remove('active');
                showToast('Đã xác nhận điều khoản', 'success');
            });
        }
        if (tosModal) {
            tosModal.addEventListener('click', (event) => {
                if (event.target === tosModal) {
                    tosModal.classList.remove('active');
                }
            });
        }
    }

    function openTermsModal() {
        if (!tosModal) return;
        tosModal.classList.add('active');
    }

    function updateTermsState() {
        if (tosStatus) {
            tosStatus.textContent = hasReadTerms
                ? 'Bạn đã đọc điều khoản dịch vụ. Có thể tiếp tục đăng nhập.'
                : 'Bạn cần đọc điều khoản dịch vụ trước khi tiếp tục.';
            tosStatus.classList.toggle('is-read', hasReadTerms);
        }
        if (tosOpen) {
            tosOpen.textContent = hasReadTerms ? 'Xem lại điều khoản dịch vụ' : 'Đọc điều khoản dịch vụ';
        }
        if (submitBtn) {
            submitBtn.disabled = !hasReadTerms || !canSubmitAuthForm;
        }
    }

    async function initRecaptcha() {
        try {
            recaptchaState = await window.RecaptchaManager.render(recaptchaContainer);
            canSubmitAuthForm = true;
        } catch (error) {
            canSubmitAuthForm = false;
            showToast(error.message || 'Không thể tải reCAPTCHA', 'error');
        } finally {
            updateTermsState();
        }
    }
};
