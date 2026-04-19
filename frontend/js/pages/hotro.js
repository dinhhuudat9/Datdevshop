// ============================================
// HO TRO PAGE (CHAT)
// File: frontend/js/pages/hotro.js
// ============================================

window.pageInit = async function() {
    const form = document.getElementById('support-form');
    const list = document.getElementById('support-messages');
    const recaptchaContainer = document.getElementById('support-message-recaptcha');
    const recaptchaStatus = document.getElementById('support-message-recaptcha-status');
    const recaptchaRetryBtn = document.getElementById('support-message-recaptcha-retry');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;

    if (!form || !list) {
        return;
    }

    let isSubmitting = false;
    let messageHumanCheck = {
        required: false,
        enabled: false,
        widgetId: null,
        status: 'idle',
        threshold: 0,
        currentCount: 0,
        message: '',
        renderError: ''
    };

    await loadThread();
    const refreshInterval = setInterval(loadThread, 8000);
    window.pageCleanup = () => {
        clearInterval(refreshInterval);
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) {
            return;
        }

        const type = form.type.value;
        const content = form.content.value.trim();
        if (!content) {
            showToast('Vui lòng nhập nội dung', 'error');
            return;
        }

        const recaptchaToken = getHumanCheckToken();
        if (recaptchaToken === null) {
            return;
        }

        isSubmitting = true;
        syncHumanCheckUi();

        try {
            const response = await api.post('/support/thread', {
                type,
                content,
                recaptcha_token: recaptchaToken
            });
            if (response.success) {
                form.content.value = '';
                await loadThread();
                list.scrollTop = list.scrollHeight;
                resetHumanCheck();
            }
        } catch (error) {
            if (isHumanCheckRequiredError(error)) {
                applyHumanCheckRequirement(error);
                return;
            }

            showToast(error.message || 'Không thể gửi tin nhắn', 'error');
        } finally {
            isSubmitting = false;
            syncHumanCheckUi();
        }
    });

    if (recaptchaRetryBtn) {
        recaptchaRetryBtn.addEventListener('click', () => {
            messageHumanCheck = {
                ...messageHumanCheck,
                enabled: false,
                widgetId: null,
                status: 'pending',
                renderError: ''
            };
            syncHumanCheckUi();
            void initHumanCheck(true);
        });
    }

    async function loadThread() {
        try {
            const response = await api.get('/support/thread');
            if (response.success) {
                renderMessages(response.data || []);
                list.scrollTop = list.scrollHeight;
            }
        } catch (error) {
            list.innerHTML = '<p>Không thể tải tin nhắn.</p>';
        }
    }

    function renderMessages(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có tin nhắn nào.</p>';
            return;
        }
        const current = Auth.getCurrentUser();
        list.innerHTML = items.map(m => `
            <div class="chat-bubble ${m.sender_id === current.id ? 'me' : 'admin'}">
                <div class="chat-meta">${m.sender_id === current.id ? 'Bạn' : 'Admin'} • ${formatDateShort(m.created_at)}</div>
                <div class="chat-text">${renderMessageBodyHtml(m)}</div>
            </div>
        `).join('');
    }

    function isHumanCheckRequiredError(error) {
        return error?.code === 'MESSAGE_HUMAN_CHECK_REQUIRED' || Boolean(error?.data?.captchaRequired);
    }

    function applyHumanCheckRequirement(error) {
        messageHumanCheck = {
            required: true,
            enabled: true,
            widgetId: null,
            status: 'pending',
            threshold: Number(error?.data?.threshold || 0),
            currentCount: Number(error?.data?.nextCount || error?.data?.currentCount || 0),
            message: error?.message || 'Bạn đang gửi tin nhắn quá nhanh. Vui lòng xác nhận reCAPTCHA để tiếp tục.',
            renderError: ''
        };
        syncHumanCheckUi();
        void initHumanCheck();
    }

    function resetHumanCheck() {
        if (recaptchaContainer) {
            recaptchaContainer.innerHTML = '';
            recaptchaContainer.classList.add('is-hidden');
        }

        if (recaptchaStatus) {
            recaptchaStatus.textContent = '';
            recaptchaStatus.classList.remove('is-error');
        }

        if (recaptchaRetryBtn) {
            recaptchaRetryBtn.hidden = true;
            recaptchaRetryBtn.disabled = false;
        }

        messageHumanCheck = {
            required: false,
            enabled: false,
            widgetId: null,
            status: 'idle',
            threshold: 0,
            currentCount: 0,
            message: '',
            renderError: ''
        };
    }

    function syncHumanCheckUi() {
        if (recaptchaContainer) {
            if (messageHumanCheck.required) {
                recaptchaContainer.classList.remove('is-hidden');
            } else {
                recaptchaContainer.classList.add('is-hidden');
                recaptchaContainer.innerHTML = '';
            }
        }

        if (recaptchaStatus) {
            recaptchaStatus.classList.toggle('is-error', messageHumanCheck.status === 'error');
            if (!messageHumanCheck.required) {
                recaptchaStatus.textContent = '';
            } else if (messageHumanCheck.status === 'loading') {
                recaptchaStatus.textContent = 'Đang tải xác thực người dùng...';
            } else if (messageHumanCheck.status === 'ready') {
                recaptchaStatus.textContent = messageHumanCheck.message || 'Đánh dấu "Tôi không phải robot" rồi gửi lại.';
            } else if (messageHumanCheck.status === 'error') {
                recaptchaStatus.textContent = messageHumanCheck.renderError || 'Không thể tải reCAPTCHA. Vui lòng thử lại.';
            } else {
                recaptchaStatus.textContent = messageHumanCheck.message || '';
            }
        }

        if (recaptchaRetryBtn) {
            recaptchaRetryBtn.hidden = messageHumanCheck.status !== 'error';
            recaptchaRetryBtn.disabled = messageHumanCheck.status === 'loading';
        }

        if (submitBtn) {
            submitBtn.disabled = isSubmitting || messageHumanCheck.status === 'loading' || messageHumanCheck.status === 'error';
            submitBtn.textContent = isSubmitting ? 'Đang gửi...' : 'Gửi';
        }
    }

    async function initHumanCheck(forceReload = false) {
        if (!messageHumanCheck.required || !recaptchaContainer) {
            return;
        }

        messageHumanCheck = {
            ...messageHumanCheck,
            enabled: false,
            widgetId: null,
            status: 'loading',
            renderError: ''
        };
        syncHumanCheckUi();

        try {
            const nextState = await window.RecaptchaManager.render(recaptchaContainer, { forceReload });
            if (!nextState.enabled) {
                throw new Error('reCAPTCHA hiện chưa sẵn sàng trên máy chủ.');
            }

            messageHumanCheck = {
                ...messageHumanCheck,
                ...nextState,
                status: 'ready',
                renderError: ''
            };
        } catch (error) {
            messageHumanCheck = {
                ...messageHumanCheck,
                enabled: false,
                widgetId: null,
                status: 'error',
                renderError: error.message || 'Không thể tải reCAPTCHA'
            };
            showToast(messageHumanCheck.renderError, 'error');
        }

        syncHumanCheckUi();
    }

    function getHumanCheckToken() {
        if (!messageHumanCheck.required) {
            return '';
        }

        if (messageHumanCheck.status === 'loading') {
            showToast('reCAPTCHA đang tải, vui lòng đợi một chút', 'warning');
            return null;
        }

        if (messageHumanCheck.status === 'error') {
            showToast(messageHumanCheck.renderError || 'Không thể tải reCAPTCHA', 'error');
            return null;
        }

        const token = messageHumanCheck.enabled
            ? window.RecaptchaManager.getResponse(messageHumanCheck.widgetId)
            : '';

        if (messageHumanCheck.enabled && !token) {
            showToast('Vui lòng xác nhận "Tôi không phải robot"', 'warning');
            return null;
        }

        return token;
    }
};
