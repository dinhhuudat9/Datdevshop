// ============================================
// EDIT PRODUCT PAGE
// File: frontend/js/pages/suasanpham.js
// ============================================

window.pageInit = async function(params) {
    const productId = params.id;
    const form = document.getElementById('edit-product-form');
    const mainImageInput = document.getElementById('edit-main-image');
    const demoMediaInput = document.getElementById('edit-demo-media');
    const previewContainer = document.getElementById('edit-upload-previews');
    const mainLabel = document.getElementById('edit-main-image-label');
    const demoLabel = document.getElementById('edit-demo-media-label');

    let mainFile = null;
    let demoFiles = [];

    await loadCategories();
    await loadProduct();
    initFilePickers();

    mainImageInput.addEventListener('change', () => {
        mainFile = mainImageInput.files && mainImageInput.files[0] ? mainImageInput.files[0] : null;
        renderPreviews();
    });

    demoMediaInput.addEventListener('change', () => {
        demoFiles = Array.from(demoMediaInput.files || []);
        renderPreviews();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const payload = {
            title: form.title.value.trim(),
            price: parseFloat(form.price.value),
            description: form.description.value.trim(),
            content: form.content.value.trim(),
            category_id: parseInt(form.category_id.value, 10),
            download_url: form.download_url.value.trim(),
            demo_url: form.demo_url.value.trim() || null,
            video_url: form.video_url.value.trim() || null
        };

        if (!payload.title || Number.isNaN(payload.price)) {
            showToast('Vui long nhap day du thong tin', 'error');
            return;
        }

        try {
            if (mainFile) {
                if (!mainFile.type.startsWith('image/')) {
                    showToast('Anh dai dien phai la file anh', 'error');
                    return;
                }

                const mainCard = previewContainer.querySelector('[data-kind="main"]');
                const mainProgress = mainCard ? mainCard.querySelector('.upload-progress-bar') : null;
                const mainText = mainCard ? mainCard.querySelector('.upload-progress-text') : null;

                const fd = new FormData();
                fd.append('file', mainFile);
                const upload = await api.uploadWithProgress('/uploads', fd, (percent) => {
                    if (mainProgress) mainProgress.style.width = `${percent}%`;
                    if (mainText) mainText.textContent = `${percent}%`;
                });
                if (upload.success) {
                    payload.main_image = upload.data.url;
                }
            }

            if (demoFiles.length) {
                const gallery = [];
                for (let i = 0; i < demoFiles.length; i++) {
                    const file = demoFiles[i];
                    if (!file.type.startsWith('image/')) {
                        showToast('Anh demo phai la file anh', 'error');
                        return;
                    }

                    const card = previewContainer.querySelector(`[data-kind="demo"][data-index="${i}"]`);
                    const bar = card ? card.querySelector('.upload-progress-bar') : null;
                    const text = card ? card.querySelector('.upload-progress-text') : null;

                    const fd = new FormData();
                    fd.append('file', file);
                    const upload = await api.uploadWithProgress('/uploads', fd, (percent) => {
                        if (bar) bar.style.width = `${percent}%`;
                        if (text) text.textContent = `${percent}%`;
                    });
                    if (upload.success) {
                        gallery.push(upload.data.url);
                    }
                }
                if (gallery.length) payload.gallery = gallery;
            }

            const res = await api.put(`/products/${productId}`, payload);
            if (res.success) {
                showToast('Da cap nhat san pham', 'success');
                mainFile = null;
                demoFiles = [];
                setFileLabel(mainImageInput, mainLabel);
                setFileLabel(demoMediaInput, demoLabel);
                renderPreviews();
                router.navigate(`/page2/${res.data.slug || res.data.id}`);
            }
        } catch (error) {
            showToast(error.message || 'Khong the cap nhat san pham', 'error');
        }
    });

    async function loadCategories() {
        const response = await api.get('/categories');
        const select = document.getElementById('edit-category');
        select.innerHTML = (response.data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    }

    async function loadProduct() {
        try {
            const response = await api.get(`/products/${productId}`);
            if (response.success) {
                const p = response.data;
                form.title.value = p.title || '';
                form.price.value = p.price || 0;
                form.description.value = p.description || '';
                form.content.value = p.content || '';
                form.download_url.value = p.download_url || '';
                form.demo_url.value = p.demo_url || '';
                form.video_url.value = p.video_url || '';
                if (p.category_id) {
                    form.category_id.value = p.category_id;
                }
            }
        } catch (error) {
            showToast('Khong the tai san pham', 'error');
        }
    }

    function renderPreviews() {
        if (!previewContainer) return;
        const items = [];

        if (mainFile) {
            items.push(renderPreviewCard(mainFile, 'Ảnh đại diện', 'main'));
        }

        demoFiles.forEach((file, idx) => {
            items.push(renderPreviewCard(file, `Ảnh demo ${idx + 1}`, 'demo', idx));
        });

        previewContainer.innerHTML = items.join('');

        previewContainer.querySelectorAll('.upload-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.kind;
                const index = btn.dataset.index ? parseInt(btn.dataset.index, 10) : -1;
                if (kind === 'main') {
                    mainFile = null;
                    mainImageInput.value = '';
                    setFileLabel(mainImageInput, mainLabel);
                } else if (kind === 'demo' && index >= 0) {
                    demoFiles.splice(index, 1);
                    demoMediaInput.value = '';
                    setFileLabel(demoMediaInput, demoLabel);
                }
                renderPreviews();
            });
        });
    }

    function renderPreviewCard(file, label, kind, index = -1) {
        const url = URL.createObjectURL(file);
        const idxAttr = index >= 0 ? ` data-index="${index}"` : '';
        return `
            <div class="upload-preview-item" data-kind="${kind}"${idxAttr}>
                <img src="${url}" class="upload-preview-img" alt="${label}">
                <button type="button" class="upload-remove" data-kind="${kind}" data-index="${index}" aria-label="Xóa">×</button>
                <div class="upload-progress">
                    <div class="upload-progress-bar"></div>
                </div>
                <div class="upload-progress-text">0%</div>
            </div>
        `;
    }
};
