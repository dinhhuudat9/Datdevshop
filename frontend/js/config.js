// ============================================
// FRONTEND CONFIG + API BASE UTILITIES
// File: frontend/js/config.js
// ============================================

(function bootstrapFrontendConfig() {
    const LOCAL_API = 'http://localhost:3000/api';
    const RELATIVE_API = '/api';

    function normalizeBase(input) {
        return String(input || '').replace(/\/+$/, '');
    }

    function guessApiBase() {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
            return LOCAL_API;
        }
        // Use same-origin API for all non-local environments; routing handled by hosting (worker/proxy/backend)
        return RELATIVE_API;
    }

    const explicit = window.__API_BASE_URL__ || window.API_BASE_URL;
    const base = normalizeBase(explicit || guessApiBase());

    window.API_BASE_URL = base;
    window.buildApiUrl = (path = '') => {
        const clean = String(path || '').replace(/^\/+/, '');
        return `${base}/${clean}`;
    };
})();
