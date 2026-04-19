// ============================================
// HOME PAGE SCRIPT
// File: frontend/js/pages/home.js
// ============================================

window.pageInit = async function(params, query) {
    const homeBannerStorageKey = 'home-banner-collapsed';
    let currentPage = parseInt(query.page || '1', 10);
    if (!Number.isFinite(currentPage) || currentPage < 1) currentPage = 1;
    let currentSort = query.sort || 'newest';
    let currentCategory = query.category_id || null;
    let currentSearch = query.search || '';
    let currentSection = query.section || '';
    let homeV2BodyObserver = null;
    let homeV2HtmlObserver = null;
    let homeV2FrameWindow = null;
    let homeV2FrameWindowResizeHandler = null;
    let viewportResizeHandler = null;

    await loadHomeContent();
    await loadCategories();
    await loadProducts();
    await loadUsers();
    bindEvents();
    initHomeBannerToggle();

    if (currentSection === 'source') {
        focusSourceSection();
    }

    window.pageCleanup = () => {
        cleanupHomeV2Frame();
        delete window.goToPage;
    };

    async function loadCategories() {
        const categoriesGrid = document.getElementById('categories-list');
        if (!categoriesGrid) {
            return;
        }

        try {
            const response = await api.get('/categories');
            const categories = response.data || [];

            categoriesGrid.innerHTML = categories.map(cat => `
                <div class="category-card" data-category="${cat.id}">
                    ${renderCategoryIcon(cat.icon)}
                    <h3>${cat.name}</h3>
                </div>
            `).join('');

            categoriesGrid.querySelectorAll('.category-card').forEach(card => {
                card.addEventListener('click', () => {
                    const categoryId = card.dataset.category;
                    currentCategory = categoryId;
                    currentPage = 1;
                    syncUrl();
                });
            });
        } catch (error) {
            categoriesGrid.innerHTML = '';
        }
    }

    async function loadHomeContent() {
        try {
            const response = await api.get('/settings', {
                keys: [
                    'home_page_version',
                    'hero_title',
                    'hero_subtitle',
                    'hero_btn_primary_text',
                    'hero_btn_primary_link',
                    'hero_btn_secondary_text',
                    'hero_btn_secondary_link',
                    'hero_card_title',
                    'hero_card_subtitle',
                    'hero_badges'
                ].join(',')
            });
            if (!response.success) return;

            const data = response.data || {};
            const homePageVersion = String(data.home_page_version || 'v1').trim().toLowerCase();
            if (homePageVersion === 'v2') {
                await renderV2HomeContent();
                return;
            }

            applyHeroSettings(data);
        } catch (error) {
            // ignore
        }
    }

    function applyHeroSettings(data) {
        const titleEl = document.getElementById('hero-title');
        const subtitleEl = document.getElementById('hero-subtitle');
        const btnPrimary = document.getElementById('hero-btn-primary');
        const btnSecondary = document.getElementById('hero-btn-secondary');
        const cardTitle = document.getElementById('hero-card-title');
        const cardSubtitle = document.getElementById('hero-card-subtitle');
        const badges = document.getElementById('hero-badges');

        if (titleEl && data.hero_title) titleEl.textContent = data.hero_title;
        if (subtitleEl && data.hero_subtitle) subtitleEl.textContent = data.hero_subtitle;
        if (btnPrimary && data.hero_btn_primary_text) btnPrimary.textContent = data.hero_btn_primary_text;
        if (btnPrimary && data.hero_btn_primary_link) btnPrimary.setAttribute('href', data.hero_btn_primary_link);
        if (btnSecondary && data.hero_btn_secondary_text) btnSecondary.textContent = data.hero_btn_secondary_text;
        if (btnSecondary && data.hero_btn_secondary_link) btnSecondary.setAttribute('href', data.hero_btn_secondary_link);
        if (cardTitle && data.hero_card_title) cardTitle.textContent = data.hero_card_title;
        if (cardSubtitle && data.hero_card_subtitle) cardSubtitle.textContent = data.hero_card_subtitle;

        if (badges && data.hero_badges) {
            const items = data.hero_badges
                .split(/\r?\n|,/)
                .map(item => item.trim())
                .filter(Boolean);
            badges.innerHTML = items.map((text, index) => {
                const cls = index % 2 === 0 ? 'badge badge-info' : 'badge badge-success';
                return `<div class="${cls}">${text}</div>`;
            }).join('');
        }
    }

    function cleanupHomeV2Frame() {
        if (homeV2BodyObserver) {
            homeV2BodyObserver.disconnect();
            homeV2BodyObserver = null;
        }

        if (homeV2HtmlObserver) {
            homeV2HtmlObserver.disconnect();
            homeV2HtmlObserver = null;
        }

        if (homeV2FrameWindow && homeV2FrameWindowResizeHandler) {
            homeV2FrameWindow.removeEventListener('resize', homeV2FrameWindowResizeHandler);
        }

        if (viewportResizeHandler) {
            window.removeEventListener('resize', viewportResizeHandler);
        }

        homeV2FrameWindow = null;
        homeV2FrameWindowResizeHandler = null;
        viewportResizeHandler = null;
    }

    async function renderV2HomeContent() {
        cleanupHomeV2Frame();

        const slot = document.getElementById('home-content-version-slot');
        if (!slot) return;

        slot.innerHTML = `
            <div class="home-v2-frame-shell">
                <iframe
                    id="home-v2-frame"
                    class="home-v2-frame"
                    title="Nội dung trang chủ V2"
                    allow="autoplay"
                ></iframe>
            </div>
        `;

        const frame = document.getElementById('home-v2-frame');
        if (!frame) return;

        try {
            const assetHtml = window.ProtectedAssets && typeof window.ProtectedAssets.fetchTextAsset === 'function'
                ? await window.ProtectedAssets.fetchTextAsset('/pages/v2.html')
                : await fetch('/pages/v2.html').then(r => r.text());

            const baseHref = `${window.location.origin}/`;
            const htmlWithBase = assetHtml.includes('<head>')
                ? assetHtml.replace('<head>', `<head><base href="${baseHref}">`)
                : assetHtml;

            frame.srcdoc = htmlWithBase;
        } catch (error) {
            slot.innerHTML = '';
            return;
        }

        const applyEmbeddedStyles = (doc) => {
            if (!doc || !doc.head || doc.getElementById('home-v2-embed-style')) {
                return;
            }

            const style = doc.createElement('style');
            style.id = 'home-v2-embed-style';
            style.textContent = `
                html, body {
                    min-height: auto !important;
                }

                body {
                    background: transparent !important;
                }

                .page-shell {
                    min-height: auto !important;
                    align-items: stretch !important;
                    justify-content: stretch !important;
                    padding: 12px !important;
                }

                .khung-thong-bao-tong {
                    min-height: auto !important;
                }

                .the-thong-bao-cao-cap {
                    width: 100% !important;
                }

                @media screen and (max-width: 560px) {
                    .page-shell {
                        padding: 8px !important;
                    }
                }
            `;

            doc.head.appendChild(style);
        };

        const syncFrameHeight = () => {
            try {
                const doc = frame.contentDocument;
                if (!doc) return;

                applyEmbeddedStyles(doc);

                const body = doc.body;
                const html = doc.documentElement;
                const heights = [
                    body ? body.scrollHeight : 0,
                    html ? html.scrollHeight : 0,
                    body ? body.offsetHeight : 0,
                    html ? html.offsetHeight : 0
                ].filter((value) => Number.isFinite(value) && value > 0);
                const fallbackMinHeight = window.innerWidth <= 768 ? 360 : 240;
                const nextHeight = Math.max(fallbackMinHeight, ...heights);

                frame.style.height = `${nextHeight}px`;
            } catch (error) {
                // ignore
            }
        };

        frame.addEventListener('load', () => {
            syncFrameHeight();

            try {
                const doc = frame.contentDocument;
                if (!doc) return;

                applyEmbeddedStyles(doc);

                if (typeof ResizeObserver !== 'undefined') {
                    if (doc.body) {
                        homeV2BodyObserver = new ResizeObserver(syncFrameHeight);
                        homeV2BodyObserver.observe(doc.body);
                    }

                    if (doc.documentElement && doc.documentElement !== doc.body) {
                        homeV2HtmlObserver = new ResizeObserver(syncFrameHeight);
                        homeV2HtmlObserver.observe(doc.documentElement);
                    }
                }

                if (frame.contentWindow) {
                    homeV2FrameWindow = frame.contentWindow;
                    homeV2FrameWindowResizeHandler = syncFrameHeight;
                    homeV2FrameWindow.addEventListener('resize', homeV2FrameWindowResizeHandler);
                }

                viewportResizeHandler = syncFrameHeight;
                window.addEventListener('resize', viewportResizeHandler);
            } catch (error) {
                // ignore
            }

            setTimeout(syncFrameHeight, 150);
            setTimeout(syncFrameHeight, 500);

            if (currentSection === 'source') {
                setTimeout(focusSourceSection, 80);
            }
        }, { once: true });
    }

    function renderCategoryIcon(icon) {
        const value = (icon || '').trim();
        if (!value) return '<i class="fas fa-layer-group"></i>';
        if (value.startsWith('http') || value.startsWith('/')) {
            return `<img src="${value}" alt="icon" class="category-icon-img">`;
        }
        return `<i class="fas ${value}"></i>`;
    }

    function initHomeBannerToggle() {
        const shell = document.getElementById('home-banner-shell');
        const toggle = document.getElementById('home-banner-toggle');
        const icon = document.getElementById('home-banner-toggle-icon');

        if (!shell || !toggle || !icon) {
            return;
        }

        const readCollapsedState = () => {
            try {
                return window.sessionStorage.getItem(homeBannerStorageKey) === '1';
            } catch (error) {
                return false;
            }
        };

        const writeCollapsedState = (collapsed) => {
            try {
                window.sessionStorage.setItem(homeBannerStorageKey, collapsed ? '1' : '0');
            } catch (error) {
                // ignore storage errors
            }
        };

        const applyCollapsedState = (collapsed) => {
            shell.classList.toggle('is-collapsed', collapsed);
            toggle.setAttribute('aria-expanded', String(!collapsed));
            toggle.setAttribute('aria-label', collapsed ? 'Mở banner' : 'Đóng banner');
            toggle.setAttribute('title', collapsed ? 'Mở banner' : 'Đóng banner');
            icon.className = collapsed ? 'fas fa-chevron-down' : 'fas fa-xmark';

            if (!collapsed) {
                requestAnimationFrame(() => {
                    window.dispatchEvent(new Event('resize'));
                });
            }
        };

        applyCollapsedState(readCollapsedState());

        toggle.addEventListener('click', () => {
            const collapsed = !shell.classList.contains('is-collapsed');
            writeCollapsedState(collapsed);
            applyCollapsedState(collapsed);
        });
    }

    async function loadProducts() {
        const grid = document.getElementById('products-grid');
        if (!grid) {
            return;
        }

        try {
            showLoading('products-grid');

            const params = {
                page: currentPage,
                limit: 10,
                sort: currentSort
            };

            if (currentCategory) params.category_id = currentCategory;
            if (currentSearch) params.search = currentSearch;

            const response = await api.get('/products', params);

            if (response.success) {
                renderProducts(response.data.products);
                renderPagination(response.data.pagination);
            }

        } catch (error) {
            console.error('Load products error:', error);
            showToast('Không thể tải sản phẩm', 'error');
            grid.innerHTML = `
                <div class="error-message">Không thể tải sản phẩm. Vui lòng thử lại.</div>
            `;
        }
    }

    async function loadUsers() {
        const section = document.getElementById('users-section');
        const grid = document.getElementById('users-grid');
        if (!section || !grid) return;

        if (!currentSearch) {
            section.style.display = 'none';
            grid.innerHTML = '';
            return;
        }

        section.style.display = 'block';
        grid.innerHTML = '';

        try {
            const response = await api.get('/users/search', { keyword: currentSearch, limit: 8 });
            if (response.success) {
                renderUsers(response.data.users || []);
            }
        } catch (error) {
            grid.innerHTML = '<div class="error-message">Không thể tải tài khoản.</div>';
        }
    }

    function renderProducts(products) {
        const grid = document.getElementById('products-grid');
        if (!grid) return;

        if (products.length === 0) {
            grid.innerHTML = `
                <div class="no-products">
                    <i class="fas fa-inbox"></i>
                    <p>Không tìm thấy sản phẩm nào</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = products.map(product => `
            <a class="product-card" href="/page2/${product.slug || product.id}" data-link>
                <img src="${getProductImageUrl(product)}" 
                     onerror="${getProductImageErrorHandler()}"
                     alt="${product.title}" 
                     class="product-image">
                <div class="product-info">
                    <div class="product-title">${product.title}</div>
                    <div class="product-price">${formatMoney(product.price)}</div>
                    <div class="product-meta">
                        <span><i class="fas fa-eye"></i> ${product.view_count}</span>
                        <span><i class="fas fa-shopping-cart"></i> ${product.purchase_count}</span>
                    </div>
                </div>
            </a>
        `).join('');
    }

    function renderUsers(users) {
        const grid = document.getElementById('users-grid');
        if (!grid) return;

        if (!users.length) {
            grid.innerHTML = `
                <div class="no-products">
                    <i class="fas fa-user"></i>
                    <p>Không tìm thấy tài khoản phù hợp</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = users.map(user => `
            <a class="user-card" href="/trangcanhan/${user.id}" data-link>
                ${renderAvatarWithFrame(user, 'lg', user.full_name || user.email || 'user')}
                <div class="user-card-info">
                    <div class="user-card-name">${renderDisplayName(user, user.email)}</div>
                    <div class="user-card-meta">${renderGender(user.gender)}</div>
                </div>
            </a>
        `).join('');
    }

    function renderGender(gender) {
        if (gender === 'female') return 'Nữ';
        if (gender === 'other') return 'Khác';
        return 'Nam';
    }

    function renderPagination(pagination) {
        const container = document.getElementById('pagination');
        if (!container || !pagination) return;
        
        if (pagination.totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let html = '';

        // Previous button
        html += `
            <button ${pagination.page === 1 ? 'disabled' : ''} 
                    onclick="goToPage(${pagination.page - 1})">
                <i class="fas fa-chevron-left"></i>
            </button>
        `;

        // Page numbers
        for (let i = 1; i <= pagination.totalPages; i++) {
            if (
                i === 1 || 
                i === pagination.totalPages || 
                (i >= pagination.page - 2 && i <= pagination.page + 2)
            ) {
                html += `
                    <button class="${i === pagination.page ? 'active' : ''}"
                            onclick="goToPage(${i})">
                        ${i}
                    </button>
                `;
            } else if (
                i === pagination.page - 3 || 
                i === pagination.page + 3
            ) {
                html += '<span>...</span>';
            }
        }

        // Next button
        html += `
            <button ${pagination.page === pagination.totalPages ? 'disabled' : ''} 
                    onclick="goToPage(${pagination.page + 1})">
                <i class="fas fa-chevron-right"></i>
            </button>
        `;

        container.innerHTML = html;
    }

    // Global function for pagination
    function buildQuery() {
        const qs = new URLSearchParams();
        if (currentSection) qs.set('section', currentSection);
        if (currentSearch) qs.set('search', currentSearch);
        if (currentCategory) qs.set('category_id', currentCategory);
        if (currentSort && currentSort !== 'newest') qs.set('sort', currentSort);
        if (currentPage && currentPage > 1) qs.set('page', currentPage);
        return qs.toString();
    }

    function syncUrl() {
        const queryString = buildQuery();
        const url = queryString ? `/?${queryString}` : '/';
        router.navigate(url);
    }

    window.goToPage = function(page) {
        currentPage = page;
        syncUrl();
    };

    function bindEvents() {
        // Sort change
        const sortSelect = document.getElementById('sort-select');
        if (sortSelect) {
            sortSelect.value = currentSort;
            sortSelect.addEventListener('change', (e) => {
                currentSort = e.target.value;
                currentPage = 1;
                syncUrl();
            });
        }
    }

    function focusSourceSection() {
        const target = document.querySelector('.products-section');
        if (!target) return;

        requestAnimationFrame(() => {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        });
    }
};
