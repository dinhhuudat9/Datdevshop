// ============================================
// COMMUNITY CHAT
// File: frontend/js/pages/congdong.js
// ============================================

window.pageInit = async function() {
    const list = document.getElementById('community-messages');
    const form = document.getElementById('community-form');
    const fileInput = document.getElementById('community-media');
    const preview = document.getElementById('community-preview');
    const fileLabel = document.getElementById('community-media-label');
    const recaptchaContainer = document.getElementById('community-message-recaptcha');
    const recaptchaStatus = document.getElementById('community-message-recaptcha-status');
    const recaptchaRetryBtn = document.getElementById('community-message-recaptcha-retry');
    const submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    const currentUser = Auth.getCurrentUser();
    const isAdmin = currentUser?.role === 'admin';

    if (!list || !form || !fileInput || !preview) {
        return;
    }

    let selectedFile = null;
    let isLoadingMessages = false;
    let hasLoadedMessages = false;
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

    await loadMessages();
    const refreshInterval = setInterval(loadMessages, 5000);
    window.pageCleanup = () => {
        clearInterval(refreshInterval);
    };
    initFilePickers();

    fileInput.addEventListener('change', () => {
        selectedFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        renderPreview();
    });

    const contentInput = form.querySelector('textarea[name="content"], input[name="content"]');
    if (contentInput) {
        contentInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                form.requestSubmit();
            }
        });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (isSubmitting) {
            return;
        }

        const rawContent = form.content.value.trim();

        if (!rawContent && !selectedFile) {
            showToast('Vui lòng nhập tin nhắn hoặc chọn ảnh', 'error');
            return;
        }

        const urlMatch = rawContent.match(/https?:\/\/\S+/i);
        if (urlMatch && isVideoUrl(urlMatch[0])) {
            showToast('Web không hỗ trợ video trong cộng đồng', 'error');
            return;
        }

        const recaptchaToken = getHumanCheckToken();
        if (recaptchaToken === null) {
            return;
        }

        isSubmitting = true;
        syncHumanCheckUi();

        try {
            let content = rawContent;
            let mediaType = null;
            let mediaUrl = null;

            if (selectedFile) {
                if (!selectedFile.type.startsWith('image/')) {
                    showToast('Chỉ hỗ trợ upload ảnh', 'error');
                    return;
                }

                const fd = new FormData();
                fd.append('file', selectedFile);

                const ring = preview.querySelector('.upload-ring-inner');
                const ringWrap = preview.querySelector('.upload-ring');
                if (ringWrap) ringWrap.style.display = 'flex';

                const upload = await api.uploadWithProgress('/uploads', fd, (percent) => {
                    if (ring) {
                        ring.style.setProperty('--progress', percent / 100);
                        ring.textContent = `${percent}%`;
                    }
                });

                if (upload.success) {
                    mediaType = 'image';
                    mediaUrl = upload.data.url;
                    if (urlMatch) {
                        content = content.replace(urlMatch[0], '').trim();
                    }
                }
            } else if (urlMatch) {
                mediaType = 'image';
                mediaUrl = urlMatch[0];
                content = content.replace(urlMatch[0], '').trim();
            }

            if (!content && !mediaUrl) {
                showToast('Vui lòng nhập tin nhắn hoặc chọn ảnh', 'error');
                return;
            }

            const res = await api.post('/community/messages', {
                content,
                message_type: mediaType || 'text',
                media_url: mediaUrl,
                recaptcha_token: recaptchaToken
            });

            if (res.success) {
                form.reset();
                selectedFile = null;
                renderPreview();
                setFileLabel(fileInput, fileLabel);
                await loadMessages();
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

    async function loadMessages() {
        if (isLoadingMessages) return;
        isLoadingMessages = true;
        try {
            const response = await api.get('/community/messages', { limit: 50 });
            if (response.success) {
                renderMessages(response.data || []);
                hasLoadedMessages = true;
            }
        } catch (error) {
            if (!hasLoadedMessages) {
                list.innerHTML = '<p>Không thể tải tin nhắn.</p>';
            }
        } finally {
            isLoadingMessages = false;
        }
    }

    function renderMessages(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có tin nhắn.</p>';
            return;
        }
        const me = Auth.getCurrentUser();
        list.innerHTML = items.map(m => {
            const isMe = me && m.user_id === me.id;
            const canDelete = isAdmin || (currentUser && Number(m.user_id) === Number(currentUser.id));
            return `
                <div class="community-item ${isMe ? 'me' : ''}">
                    ${renderAvatarWithFrame(m, 'sm', m.full_name || m.email || `User #${m.user_id}`)}
                    <div class="community-bubble">
                        <div class="community-meta">
                            <strong>${renderDisplayName(m, m.email || `User #${m.user_id}`)}</strong>
                            <div class="community-meta-side">
                                <span>${formatDateShort(m.created_at)}</span>
                                ${canDelete ? `
                                    <button type="button" class="btn-ghost btn-danger community-delete-btn" data-community-delete="${m.id}">Xóa</button>
                                ` : ''}
                            </div>
                        </div>
                        ${m.content ? `<div class="community-text">${formatPlainTextHtml(m.content)}</div>` : ''}
                        ${renderMedia(m)}
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('button[data-community-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Xóa tin nhắn cộng đồng này?')) return;
                try {
                    const resp = await api.delete(`/community/messages/${btn.dataset.communityDelete}`);
                    if (resp.success) {
                        showToast('Đã xóa tin nhắn', 'success');
                        await loadMessages();
                    }
                } catch (deleteError) {
                    showToast(deleteError.message || 'Không thể xóa tin nhắn', 'error');
                }
            });
        });
    }

    function renderMedia(msg) {
        if (!msg.media_url) return '';
        if (msg.message_type === 'image') {
            return `<img src="${escapeHtml(msg.media_url)}" class="community-media" alt="media">`;
        }
        return '';
    }

    function renderPreview() {
        if (!preview) return;
        if (!selectedFile) {
            preview.innerHTML = '';
            return;
        }

        const url = URL.createObjectURL(selectedFile);
        preview.innerHTML = `
            <div class="upload-preview-item">
                <img src="${url}" class="upload-preview-img" alt="preview">
                <button type="button" class="upload-remove" aria-label="Xóa">×</button>
                <div class="upload-ring" style="display:none;">
                    <div class="upload-ring-inner" style="--progress:0;">0%</div>
                </div>
            </div>
        `;

        const btn = preview.querySelector('.upload-remove');
        if (btn) {
            btn.addEventListener('click', () => {
                selectedFile = null;
                fileInput.value = '';
                setFileLabel(fileInput, fileLabel);
                renderPreview();
            });
        }
    }

    function isVideoUrl(url) {
        const lower = url.toLowerCase();
        return !!lower.match(/\.(mp4|webm|ogg|mov|avi)(\?.*)?$/);
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
