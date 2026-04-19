// ============================================
// TO CAO PAGE
// File: frontend/js/pages/tocao.js
// ============================================

window.pageInit = async function() {
    const form = document.getElementById('report-form');
    const list = document.getElementById('report-list');

    await loadRequests();
    const refreshInterval = setInterval(loadRequests, 15000);
    window.pageCleanup = () => {
        clearInterval(refreshInterval);
    };

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const subject = form.subject.value.trim();
        const content = form.content.value.trim();
        if (!subject || !content) {
            showToast('Vui lòng nhập đầy đủ thông tin', 'error');
            return;
        }
        try {
            const response = await api.post('/support', {
                type: 'report',
                subject,
                content
            });
            if (response.success) {
                showToast('Đã gửi tố cáo', 'success');
                form.reset();
                await loadRequests();
            }
        } catch (error) {
            showToast(error.message || 'Không thể gửi tố cáo', 'error');
        }
    });

    async function loadRequests() {
        try {
            const response = await api.get('/support/my', { type: 'report' });
            if (response.success) {
                renderList(response.data || []);
            }
        } catch (error) {
            list.innerHTML = '<p>Không thể tải lịch sử tố cáo.</p>';
        }
    }

    function renderList(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có tố cáo nào.</p>';
            return;
        }
        list.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Tiêu đề</th>
                        <th>Trạng thái</th>
                        <th>Phản hồi</th>
                        <th>Ngày tạo</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(it => `
                        <tr>
                            <td>${it.subject}</td>
                            <td>${statusLabel(it.status)}</td>
                            <td>${it.admin_reply || '-'}</td>
                            <td>${formatDateShort(it.created_at)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    function statusLabel(status) {
        if (status === 'replied') return '<span class="badge badge-success">Đã phản hồi</span>';
        if (status === 'closed') return '<span class="badge badge-danger">Đã đóng</span>';
        return '<span class="badge badge-warning">Đang xử lý</span>';
    }
};
