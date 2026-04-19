// ============================================
// DANG BAN PAGE
// File: frontend/js/pages/dangban.js
// ============================================

window.pageInit = async function() {
    const form = document.getElementById('product-form');
    const mainImageInput = document.getElementById('main-image');
    const demoMediaInput = document.getElementById('demo-media');
    const previewContainer = document.getElementById('product-upload-previews');
    const mainLabel = document.getElementById('main-image-label');
    const demoLabel = document.getElementById('demo-media-label');

    let mainFile = null;
    let demoFiles = [];

    await loadCategories();
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

        const title = form.title.value.trim();
        const price = parseFloat(form.price.value);
        const description = form.description.value.trim();
        const category_ids = Array.from(form.category_ids.selectedOptions).map(opt => parseInt(opt.value));
        const download_url = form.download_url.value.trim();
        const demo_url = form.demo_url.value.trim();
        const video_url_input = form.video_url ? form.video_url.value.trim() : '';

        if (!title || !description || !download_url || !category_ids.length || Number.isNaN(price)) {
            showToast('Vui lòng điền đầy đủ thông tin bắt buộc', 'error');
            return;
        }

        if (!mainFile) {
            showToast('Vui lòng chọn ảnh đại diện sản phẩm', 'error');
            return;
        }

        if (!demoFiles.length && !demo_url && !video_url_input) {
            showToast('Vui lòng chọn ảnh demo hoặc nhập link demo/video', 'error');
            return;
        }

        try {
            if (!mainFile.type.startsWith('image/')) {
                showToast('Ảnh đại diện phải là file ảnh', 'error');
                return;
            }

            const mainCard = previewContainer.querySelector('[data-kind="main"]');
            const mainProgress = mainCard ? mainCard.querySelector('.upload-progress-bar') : null;
            const mainText = mainCard ? mainCard.querySelector('.upload-progress-text') : null;

            const mainFd = new FormData();
            mainFd.append('file', mainFile);
            const mainUpload = await api.uploadWithProgress('/uploads', mainFd, (percent) => {
                if (mainProgress) mainProgress.style.width = `${percent}%`;
                if (mainText) mainText.textContent = `${percent}%`;
            });

            if (!mainUpload.success) {
                throw new Error('Không thể upload ảnh đại diện');
            }

            const main_image = mainUpload.data.url;
            const video_url = video_url_input || null;
            const gallery = [];

            for (let i = 0; i < demoFiles.length; i++) {
                const file = demoFiles[i];
                if (!file.type.startsWith('image/')) {
                    showToast('Ảnh demo phải là file ảnh', 'error');
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

            const payload = {
                title,
                slug: createSlug(title),
                price,
                category_id: category_ids[0],
                category_ids,
                description,
                main_image,
                video_url,
                demo_url: demo_url || null,
                download_url
            };

            if (gallery.length) payload.gallery = gallery;

            const response = await api.post('/products', payload);
            if (response.success) {
                showToast('Đăng sản phẩm thành công', 'success');
                form.reset();
                mainFile = null;
                demoFiles = [];
                setFileLabel(mainImageInput, mainLabel);
                setFileLabel(demoMediaInput, demoLabel);
                renderPreviews();
            }
        } catch (error) {
            showToast(error.message || 'Không thể đăng sản phẩm', 'error');
        }
    });

    async function loadCategories() {
        const response = await api.get('/categories');
        const select = document.getElementById('category-select');
        select.innerHTML = (response.data || []).map(c => `<option value="${c.id}">${c.name}</option>`).join('');
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
