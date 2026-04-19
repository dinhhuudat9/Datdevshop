// ============================================
// NAP TIEN PAGE
// File: frontend/js/pages/naptien.js
// ============================================

window.pageInit = async function() {
    const form = document.getElementById('deposit-form');
    const list = document.getElementById('deposit-requests');
    const fileInput = document.getElementById('payment-proof');
    const previewContainer = document.getElementById('deposit-upload-previews');
    const fileLabel = document.getElementById('payment-proof-label');

    let proofFile = null;

    await loadRequests();
    await loadBankInfo();
    await refreshBalance();
    initFilePickers();
    setInterval(async () => {
        await loadRequests();
        await refreshBalance();
    }, 30000);

    fileInput.addEventListener('change', () => {
        proofFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        renderPreview();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const amount = parseFloat(form.amount.value);
        const payment_method = form.payment_method.value;
        let payment_proof = null;

        if (!amount || amount <= 0) {
            showToast('Số tiền không hợp lệ', 'error');
            return;
        }

        try {
            if (proofFile) {
                if (!proofFile.type.startsWith('image/')) {
                    showToast('Ảnh chứng từ phải là file ảnh', 'error');
                    return;
                }

                const bar = previewContainer ? previewContainer.querySelector('.upload-progress-bar') : null;
                const text = previewContainer ? previewContainer.querySelector('.upload-progress-text') : null;

                const fd = new FormData();
                fd.append('file', proofFile);
                const upload = await api.uploadWithProgress('/uploads', fd, (percent) => {
                    if (bar) bar.style.width = `${percent}%`;
                    if (text) text.textContent = `${percent}%`;
                });
                if (upload.success) {
                    payment_proof = upload.data.url;
                }
            }

            const response = await api.post('/wallet/deposit-request', {
                amount,
                payment_method,
                payment_proof
            });

            if (response.success) {
                showToast('Đã gửi yêu cầu nạp tiền', 'success');
                form.reset();
                proofFile = null;
                setFileLabel(fileInput, fileLabel);
                renderPreview();
                await loadRequests();
                await refreshBalance();
            }
        } catch (error) {
            showToast(error.message || 'Không thể gửi yêu cầu', 'error');
        }
    });

    async function loadRequests() {
        try {
            const response = await api.get('/wallet/deposit-requests');
            if (response.success) {
                renderRequests(response.data);
            }
        } catch (error) {
            list.innerHTML = '<p>Không thể tải danh sách yêu cầu</p>';
        }
    }

    async function loadBankInfo() {
        const section = document.getElementById('bank-info');
        if (!section) return;
        try {
            const response = await api.get('/settings', {
                keys: 'bank_qr_url,bank_name,bank_account_number,bank_account_name,bank_note'
            });
            if (!response.success) return;
            const data = response.data || {};

            if (!data.bank_name && !data.bank_account_number && !data.bank_account_name && !data.bank_qr_url) {
                section.style.display = 'none';
                return;
            }

            section.style.display = 'block';
            const qrImg = document.getElementById('bank-qr-image');
            const nameEl = document.getElementById('bank-name');
            const numberEl = document.getElementById('bank-account-number');
            const ownerEl = document.getElementById('bank-account-name');
            const noteRow = document.getElementById('bank-note-row');
            const noteEl = document.getElementById('bank-note');

            if (qrImg) {
                qrImg.src = data.bank_qr_url || '';
                qrImg.style.display = data.bank_qr_url ? 'block' : 'none';
            }
            if (nameEl) nameEl.textContent = data.bank_name || '-';
            if (numberEl) numberEl.textContent = data.bank_account_number || '-';
            if (ownerEl) ownerEl.textContent = data.bank_account_name || '-';
            if (noteEl) noteEl.textContent = data.bank_note || '';
            if (noteRow) noteRow.style.display = data.bank_note ? 'block' : 'none';
        } catch (error) {
            section.style.display = 'none';
        }
    }

    async function refreshBalance() {
        if (!Auth.isAuthenticated()) return;
        try {
            const response = await api.get('/auth/me');
            if (response.success) {
                Auth.saveAuth(localStorage.getItem('token'), response.data);
                const userSection = document.getElementById('user-section');
                if (userSection) {
                    const app = window.appInstance;
                    if (app && typeof app.updateUserSection === 'function') {
                        app.updateUserSection();
                    }
                }
            }
        } catch (error) {
            // ignore
        }
    }

    function renderRequests(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có yêu cầu nạp tiền.</p>';
            return;
        }

        const statusLabel = (status) => {
            if (status === 'approved') return '<span class="badge badge-success">Đã duyệt</span>';
            if (status === 'rejected') return '<span class="badge badge-danger">Từ chối</span>';
            return '<span class="badge badge-warning">Chờ duyệt</span>';
        };

        list.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Số tiền</th>
                        <th>Phương thức</th>
                        <th>Trạng thái</th>
                        <th>Ngày tạo</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>${formatMoney(item.amount)}</td>
                            <td>${item.payment_method || '-'}</td>
                            <td>${statusLabel(item.status)}</td>
                            <td>${formatDateShort(item.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    function renderPreview() {
        if (!previewContainer) return;
        if (!proofFile) {
            previewContainer.innerHTML = '';
            return;
        }

        const url = URL.createObjectURL(proofFile);
        previewContainer.innerHTML = `
            <div class="upload-preview-item">
                <img src="${url}" class="upload-preview-img" alt="preview">
                <button type="button" class="upload-remove" aria-label="Xóa">×</button>
                <div class="upload-progress">
                    <div class="upload-progress-bar"></div>
                </div>
                <div class="upload-progress-text">0%</div>
            </div>
        `;

        const btn = previewContainer.querySelector('.upload-remove');
        if (btn) {
            btn.addEventListener('click', () => {
                proofFile = null;
                fileInput.value = '';
                setFileLabel(fileInput, fileLabel);
                renderPreview();
            });
        }
    }
};
