// ============================================
// UTILITIES
// File: frontend/js/utils.js
// ============================================

// Format tiền VND
function formatMoney(amount) {
    return new Intl.NumberFormat('vi-VN', {
        style: 'currency',
        currency: 'VND'
    }).format(amount);
}

// Format ngày
function formatDate(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('vi-VN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
}

// Format ngày ngắn
function formatDateShort(dateString) {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('vi-VN').format(date);
}

function escapeHtml(input) {
    return String(input ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatPlainTextHtml(input) {
    return escapeHtml(input).replace(/\r?\n/g, '<br>');
}

function getMessageTypeLabel(type = 'text') {
    switch (String(type || '').toLowerCase()) {
        case 'image':
            return '[Anh]';
        case 'video':
            return '[Video]';
        case 'file':
            return '[File]';
        default:
            return '[Tin nhan]';
    }
}

function getMessagePreview(message = {}, maxLength = 120) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    const mediaUrl = typeof message.media_url === 'string' ? message.media_url.trim() : '';
    const base = content || (mediaUrl ? `${getMessageTypeLabel(message.message_type)} ${mediaUrl}` : '');

    if (!base) {
        return 'Khong co noi dung';
    }

    if (base.length <= maxLength) {
        return base;
    }

    return `${base.slice(0, maxLength).trimEnd()}...`;
}

function renderMessageBodyHtml(message = {}) {
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    const mediaUrl = typeof message.media_url === 'string' ? message.media_url.trim() : '';
    const parts = [];

    if (content) {
        parts.push(`<div class="message-text-block">${formatPlainTextHtml(content)}</div>`);
    }

    if (mediaUrl) {
        const safeUrl = escapeHtml(mediaUrl);
        const label = escapeHtml(getMessageTypeLabel(message.message_type));
        parts.push(`<a href="${safeUrl}" class="message-media-link" target="_blank" rel="noopener noreferrer">${label}</a>`);
    }

    if (!parts.length) {
        return '<span class="message-empty">Khong co noi dung</span>';
    }

    return parts.join('');
}

// Show toast notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    const icons = {
        success: 'fa-check-circle',
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        info: 'fa-info-circle'
    };

    toast.innerHTML = `
        <i class="fas ${icons[type] || icons.info}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove after 3s
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Tạo slug từ title
function createSlug(text) {
    return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .trim();
}

// Debounce function
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Get query params
function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(params);
}

// Validate email
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Loading spinner
function showLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerHTML = `
            <div class="loading-container">
                <img class="spinner" src="/img/gif_loaderB46.png" alt="Dang tai">
                <p>Đang tải...</p>
            </div>
        `;
    }
}

// Hide loading
function hideLoading(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        const loading = element.querySelector('.loading-container');
        if (loading) loading.remove();
    }
}

// Confirm dialog
function confirmDialog(message) {
    return confirm(message);
}

// Copy to clipboard
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Đã copy vào clipboard', 'success');
    } catch (err) {
        showToast('Không thể copy', 'error');
    }
}

// Avatar helper (ưu tiên avatar, fallback theo giới tính)
function getAvatarUrl(user = {}) {
    if (user.avatar) return user.avatar;
    if (user.gender === 'female') return '/img/nu.jpg';
    return '/img/nam.png';
}

function hasVerifiedBadge(user = {}) {
    return Number(user?.is_verified || 0) === 1;
}

function renderVerifiedBadge(user = {}, className = 'verified-badge-inline') {
    if (!hasVerifiedBadge(user)) return '';
    return `<img src="/img/tichxanh.svg" class="${className}" alt="verified badge">`;
}

function renderDisplayName(user = {}, fallback = '') {
    const text = escapeHtml(user.full_name || user.email || fallback || '');
    return `
        <span class="user-name-with-badge">
            <span>${text}</span>
            ${renderVerifiedBadge(user)}
        </span>
    `;
}

const PRODUCT_PLACEHOLDER_URL = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 720">' +
    '<defs>' +
    '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0%" stop-color="#f4efe6"/>' +
    '<stop offset="100%" stop-color="#e8dfd2"/>' +
    '</linearGradient>' +
    '</defs>' +
    '<rect width="960" height="720" rx="36" fill="url(#bg)"/>' +
    '<circle cx="350" cy="260" r="84" fill="#cbbcab"/>' +
    '<path d="M208 540c48-110 132-166 252-166 74 0 137 20 190 60 40 30 71 66 94 106H208z" fill="#d8cbbb"/>' +
    '<rect x="116" y="88" width="728" height="544" rx="28" fill="none" stroke="#cab9a6" stroke-width="18" stroke-dasharray="18 20"/>' +
    '<text x="480" y="642" text-anchor="middle" font-size="34" font-family="Arial, Helvetica, sans-serif" fill="#7b6852">San pham chua co anh</text>' +
    '</svg>'
)}`;

function getProductPlaceholderUrl() {
    return PRODUCT_PLACEHOLDER_URL;
}

function getProductImageUrl(product = {}) {
    const value = typeof product === 'string'
        ? product
        : (product && typeof product.main_image === 'string' ? product.main_image : '');
    const url = (value || '').trim();
    if (url) return url;
    if (product && typeof product === 'object') {
        const galleryUrls = getProductGalleryUrls(product).filter(item => item !== PRODUCT_PLACEHOLDER_URL);
        if (galleryUrls.length > 0) {
            return galleryUrls[0];
        }
    }
    return PRODUCT_PLACEHOLDER_URL;
}

function getProductImageErrorHandler() {
    return `this.onerror=null;this.src='${PRODUCT_PLACEHOLDER_URL}'`;
}

function getProductGalleryUrls(product = {}) {
    const urls = [];
    const seen = new Set();
    const mainImage = (product && typeof product.main_image === 'string')
        ? product.main_image.trim()
        : '';
    const gallery = Array.isArray(product.gallery) ? product.gallery : [];

    [mainImage, ...gallery.map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item.image_url === 'string') return item.image_url;
        return '';
    })].forEach(rawUrl => {
        const url = (rawUrl || '').trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        urls.push(url);
    });

    return urls.length ? urls : [PRODUCT_PLACEHOLDER_URL];
}

// Render avatar with optional frame overlay
function renderAvatarWithFrame(user = {}, size = 'md', alt = 'avatar') {
    const frame = user.frame_url ? `<img src="${user.frame_url}" class="avatar-frame" alt="frame">` : '';
    const verified = renderVerifiedBadge(user, 'avatar-verified-badge');
    return `
        <div class="avatar-wrap avatar-wrap-${size}">
            <img src="${getAvatarUrl(user)}" class="avatar-base" alt="${alt || 'avatar'}">
            ${frame}
            ${verified}
        </div>
    `;
}

// File picker helpers
function setFileLabel(inputEl, labelEl) {
    if (!labelEl) return;
    if (inputEl && inputEl.files && inputEl.files.length) {
        if (inputEl.multiple && inputEl.files.length > 1) {
            labelEl.textContent = `Đã chọn ${inputEl.files.length} file`;
            return;
        }
        labelEl.textContent = inputEl.files[0].name;
    } else {
        labelEl.textContent = 'Chưa chọn file';
    }
}

function initFilePickers(root = document) {
    root.querySelectorAll('.file-btn[data-file-target]').forEach(btn => {
        const inputId = btn.dataset.fileTarget;
        const labelId = btn.dataset.fileLabel;
        const inputEl = document.getElementById(inputId);
        const labelEl = labelId ? document.getElementById(labelId) : null;

        if (!inputEl) return;

        btn.addEventListener('click', () => {
            inputEl.click();
        });

        inputEl.addEventListener('change', () => {
            setFileLabel(inputEl, labelEl);
        });

        setFileLabel(inputEl, labelEl);
    });
}

// Cloudinary upload (audio/video) helper
const CLOUDINARY_UPLOAD_URL = 'https://api.cloudinary.com/v1_1/dmnlfbtsq/video/upload';

function isAudioFile(file) {
    if (!file) return false;
    return /^audio\//.test(file.type) || /\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(file.name || '');
}

function uploadToCloudinary(file, { uploadPreset = 'audio_upload', onProgress } = {}) {
    return new Promise((resolve, reject) => {
        if (!file) {
            reject(new Error('Chưa chọn file'));
            return;
        }
        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', uploadPreset || 'ml_default');

        const xhr = new XMLHttpRequest();
        xhr.open('POST', CLOUDINARY_UPLOAD_URL, true);

        xhr.upload.addEventListener('progress', (event) => {
            if (!event.lengthComputable || typeof onProgress !== 'function') return;
            const percent = Math.round((event.loaded / event.total) * 100);
            onProgress(percent);
        });

        xhr.onreadystatechange = () => {
            if (xhr.readyState !== 4) return;
            try {
                const response = JSON.parse(xhr.responseText || '{}');
                if (xhr.status >= 200 && xhr.status < 300) {
                    const url = response.secure_url || response.url;
                    const errMsg = response && response.error ? response.error.message : 'Upload thất bại';
                    if (!url) {
                        reject(new Error(errMsg));
                        return;
                    }
                    resolve({
                        url,
                        public_id: response.public_id,
                        duration: response.duration
                    });
                } else {
                    const errMsg = response && response.error ? response.error.message : 'Upload thất bại';
                    reject(new Error(errMsg));
                }
            } catch (error) {
                reject(error);
            }
        };

        xhr.onerror = () => reject(new Error('Upload thất bại'));
        xhr.send(formData);
    });
}
