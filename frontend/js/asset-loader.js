// ============================================
// PROTECTED ASSET LOADER
// Loads HTML/CSS via encoded backend payloads
// ============================================

(function bootstrapProtectedAssets() {
    const DEFAULT_STYLE_PATHS = ['/css/main.css', '/css/components.css'];
    const BLOCKED_IP_PATH = '/blocked-ip.html';
    const HUMAN_CHECK_URL = `${window.location.origin}/human-check.html`;
    const HUMAN_GATE_CODE = 'HUMAN_GATE_REQUIRED';
    const REQUEST_HEADERS = {
        'X-Requested-With': 'XMLHttpRequest'
    };
    const buildApiUrl = window.buildApiUrl || ((path = '') => {
        const clean = String(path || '').replace(/^\/+/, '');
        return `/api/${clean}`;
    });
    let bootstrapPromise = null;
    let stylesPromise = null;

    document.documentElement.classList.add('protected-assets-loading');

    function getKeyBytes(assetKey) {
        return new TextEncoder().encode(String(assetKey || ''));
    }

    function decodePayload(payload = '', assetKey = '') {
        const source = Uint8Array.from(atob(String(payload || '')), char => char.charCodeAt(0));
        const key = getKeyBytes(assetKey);
        const decoded = new Uint8Array(source.length);

        for (let index = 0; index < source.length; index += 1) {
            decoded[index] = source[index] ^ key[index % key.length];
        }

        return new TextDecoder().decode(decoded);
    }

    function hasInvalidControlChars(value = '') {
        return /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(String(value || ''));
    }

    function looksLikeDecodedAsset(content = '', assetPath = '') {
        const text = String(content || '').trim();
        if (!text || hasInvalidControlChars(text)) {
            return false;
        }

        if (assetPath.endsWith('.html')) {
            return text.startsWith('<') && /<\/?[a-z][\s>]/i.test(text);
        }

        if (assetPath.endsWith('.css')) {
            return /[{}]/.test(text);
        }

        return true;
    }

    function isBlockedResponse(response) {
        if (!response?.url) {
            return false;
        }

        try {
            const responseUrl = new URL(response.url, window.location.origin);
            return responseUrl.pathname === BLOCKED_IP_PATH;
        } catch (_) {
            return false;
        }
    }

    function redirectBlockedResponse(response) {
        const responseUrl = new URL(response.url, window.location.origin);
        window.location.replace(`${responseUrl.pathname}${responseUrl.search}${responseUrl.hash}`);
    }

    function redirectHumanGate() {
        try {
            const gateUrl = new URL(HUMAN_CHECK_URL, window.location.origin);
            // Avoid loop if we're already on the human check page
            if (window.location.pathname === gateUrl.pathname) {
                return;
            }
            const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            gateUrl.searchParams.set('next', next);
            window.location.replace(gateUrl.toString());
        } catch (_) {
            // Fallback to hard reload if URL parsing fails
            window.location.reload();
        }
    }

    async function fetchBootstrap(forceRefresh = false) {
        if (forceRefresh) {
            bootstrapPromise = null;
        }

        if (!bootstrapPromise) {
            bootstrapPromise = (async () => {
                const response = await fetch(buildApiUrl('assets/bootstrap'), {
                    credentials: 'include',
                    headers: REQUEST_HEADERS
                });

                if (isBlockedResponse(response)) {
                    redirectBlockedResponse(response);
                    throw new Error('IP cua ban dang bi khoa tam thoi');
                }

                const data = await response.json();
                if (data?.code === HUMAN_GATE_CODE) {
                    redirectHumanGate();
                    throw new Error(data.message || 'Vui long xac nhan ban la nguoi that');
                }
                if (!response.ok || !data.success || !data.data?.assetKey || !data.data?.sessionId) {
                    throw new Error(data.message || 'Khong the lay khoa asset tu backend');
                }

                return data.data;
            })().catch((error) => {
                bootstrapPromise = null;
                throw error;
            });
        }

        return bootstrapPromise;
    }

    async function fetchAssetMeta(assetPath, hasRetried = false) {
        const bootstrap = await fetchBootstrap();

        const response = await fetch(buildApiUrl(`assets/text?path=${encodeURIComponent(assetPath)}`), {
            credentials: 'include',
            headers: {
                ...REQUEST_HEADERS,
                'X-Asset-Session-Id': String(bootstrap?.sessionId || '')
            }
        });

        if (isBlockedResponse(response)) {
            redirectBlockedResponse(response);
            throw new Error('IP cua ban dang bi khoa tam thoi');
        }

        if (response.status === 403 && !hasRetried) {
            await fetchBootstrap(true);
            return fetchAssetMeta(assetPath, true);
        }

        const data = await response.json();
        if (data?.code === HUMAN_GATE_CODE) {
            redirectHumanGate();
            throw new Error(data.message || 'Vui long xac nhan ban la nguoi that');
        }
        if (!response.ok || !data.success) {
            throw new Error(data.message || `Khong the tai asset: ${assetPath}`);
        }

        return {
            asset: data.data,
            bootstrap
        };
    }

    async function fetchTextAsset(assetPath, hasRetried = false) {
        try {
            const { asset, bootstrap } = await fetchAssetMeta(assetPath);
            const decoded = decodePayload(asset.payload, bootstrap.assetKey);

            if (looksLikeDecodedAsset(decoded, assetPath)) {
                return decoded;
            }

            if (!hasRetried) {
                await fetchBootstrap(true);
                return fetchTextAsset(assetPath, true);
            }

            // Fallback: try to load raw asset directly (non-protected)
            try {
                const direct = await fetch(assetPath, { credentials: 'include' }).then((r) => r.text());
                if (looksLikeDecodedAsset(direct, assetPath)) {
                    return direct;
                }
            } catch (_) {
                // ignore
            }

            // Last resort: return decoded even if heuristic fails, to avoid blank page
            return decoded;
        } catch (error) {
            // If protected fetch fails (e.g., backend down), try to fetch raw asset so UI still renders
            try {
                const direct = await fetch(assetPath, { credentials: 'include' }).then((r) => r.text());
                if (looksLikeDecodedAsset(direct, assetPath)) {
                    return direct;
                }
            } catch (_) {
                // ignore
            }
            throw error;
        }
    }

    function ensureStyleTag(assetPath) {
        const selector = `style[data-protected-asset="${assetPath}"]`;
        let styleTag = document.querySelector(selector);
        if (!styleTag) {
            styleTag = document.createElement('style');
            styleTag.setAttribute('data-protected-asset', assetPath);
            document.head.appendChild(styleTag);
        }
        return styleTag;
    }

    async function loadStyles(stylePaths = DEFAULT_STYLE_PATHS) {
        if (!stylesPromise) {
            stylesPromise = (async () => {
                const cssList = await Promise.all(stylePaths.map(fetchTextAsset));
                cssList.forEach((cssText, index) => {
                    ensureStyleTag(stylePaths[index]).textContent = cssText;
                });
                document.documentElement.classList.remove('protected-assets-loading');
                document.documentElement.classList.add('protected-assets-ready');
            })().catch((error) => {
                stylesPromise = null;
                document.documentElement.classList.remove('protected-assets-loading');
                // Still show the page (unstyled) to allow human-check or error messages
                document.documentElement.classList.add('protected-assets-ready');
                throw error;
            });
        }

        return stylesPromise;
    }

    window.ProtectedAssets = {
        fetchBootstrap,
        fetchTextAsset,
        loadStyles
    };

    void loadStyles().catch((error) => {
        console.error('Protected asset loader error:', error);
    });
})();
