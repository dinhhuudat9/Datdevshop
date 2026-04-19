// ============================================
// LICH SU MUA PAGE
// File: frontend/js/pages/lichsumua.js
// ============================================

window.pageInit = async function() {
    const list = document.getElementById('purchase-list');

    try {
        const response = await api.get('/wallet/purchases');
        if (response.success) {
            renderPurchases(response.data.purchases || []);
        }
    } catch (error) {
        list.innerHTML = '<p>Không thể tải lịch sử mua hàng.</p>';
    }

    function renderPurchases(items) {
        if (!items.length) {
            list.innerHTML = '<p>Chưa có giao dịch mua nào.</p>';
            return;
        }

        list.innerHTML = `
            <table class="table">
                <thead>
                    <tr>
                        <th>Sản phẩm</th>
                        <th>Giá</th>
                        <th>Ngày mua</th>
                        <th>Tải về</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => `
                        <tr>
                            <td>
                                <a href="/page2/${item.slug || item.product_id}" data-link onclick="event.preventDefault(); window.router && window.router.navigate('/page2/${item.slug || item.product_id}')">
                                    ${item.title || 'Sản phẩm đã lưu trữ'}
                                </a>
                                ${item.is_archived ? '<span class="badge badge-info" style="margin-left:6px;">Lưu trữ</span>' : ''}
                            </td>
                            <td>${formatMoney(item.price_paid)}</td>
                            <td>${formatDateShort(item.created_at)}</td>
                            <td>
                                ${item.download_url ? `<a class="btn btn-primary" href="${item.download_url}" target="_blank">Tải về</a>` : '-'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }
};
