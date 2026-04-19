// ============================================
// API CLIENT
// File: frontend/js/api.js
// ============================================

const API_BASE_URL = (() => {
    const explicit = window.API_BASE_URL || window.__API_BASE_URL__;
    if (explicit) {
        return String(explicit).replace(/\/+$/, '');
    }

    const host = window.location.hostname;
    const origin = window.location.origin;
    const relativeBase = '/api';

    // Local development
    if (host === 'localhost' || host === '127.0.0.1') {
        return 'http://localhost:3000/api';
    }

    // Default: same-origin API path; hosting/edge should proxy as needed
    return relativeBase;
})();

const HUMAN_CHECK_URL = `${window.location.origin}/human-check.html`;

window.API_BASE_URL = API_BASE_URL;
if (typeof window.buildApiUrl !== 'function') {
    window.buildApiUrl = (path = '') => {
        const clean = String(path || '').replace(/^\/+/, '');
        return `${API_BASE_URL}/${clean}`;
    };
}

class APIClient {
    constructor(baseURL) {
        this.baseURL = baseURL;
        this.blockedIpPath = '/blocked-ip.html';
        this.humanGateCode = 'HUMAN_GATE_REQUIRED';
    }

    getHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };
        
        const token = localStorage.getItem('token');
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }
        
        return headers;
    }

    shouldAttachClientIp(endpoint = '') {
        const value = String(endpoint || '');
        return value.startsWith('/auth/') || value === '/security/visitor-entry';
    }

    async getClientIpHeaders(endpoint) {
        if (!this.shouldAttachClientIp(endpoint)) {
            return {};
        }

        if (!window.PublicIpManager || typeof window.PublicIpManager.getPublicIp !== 'function') {
            return {};
        }

        try {
            const publicIp = await window.PublicIpManager.getPublicIp();
            if (!publicIp) {
                return {};
            }

            return {
                'X-Client-Public-IP': publicIp
            };
        } catch (_) {
            return {};
        }
    }

    isBlockedIpResponse(response) {
        if (!response?.url) {
            return false;
        }

        try {
            const responseUrl = new URL(response.url, window.location.origin);
            return responseUrl.pathname === this.blockedIpPath;
        } catch (_) {
            return false;
        }
    }

    redirectToBlockedIp(response) {
        const responseUrl = new URL(response.url, window.location.origin);
        const target = `${responseUrl.pathname}${responseUrl.search}${responseUrl.hash}`;
        window.location.replace(target);
    }

    redirectToHumanGate() {
        try {
            const gateUrl = new URL(HUMAN_CHECK_URL, window.location.origin);
            // Prevent redirect loop if already on gate page
            if (window.location.pathname === gateUrl.pathname) {
                return;
            }
            const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
            gateUrl.searchParams.set('next', next);
            window.location.replace(gateUrl.toString());
        } catch (_) {
            window.location.reload();
        }
    }

    async request(endpoint, options = {}) {
        const url = this.baseURL + endpoint;
        const clientIpHeaders = await this.getClientIpHeaders(endpoint);
        const config = {
            ...options,
            credentials: 'include',
            headers: {
                ...this.getHeaders(),
                ...clientIpHeaders,
                ...options.headers
            }
        };

        try {
            const response = await fetch(url, config);
            if (this.isBlockedIpResponse(response)) {
                this.redirectToBlockedIp(response);
                throw new Error('IP cua ban dang bi khoa tam thoi');
            }

            const contentType = response.headers.get('content-type') || '';
            const data = contentType.includes('application/json')
                ? await response.json()
                : null;

            if (!response.ok) {
                const error = new Error(data?.message || 'Request failed');
                error.status = response.status;
                error.code = data?.code || '';
                error.data = data?.data;
                error.payload = data;
                error.retryAfter = response.headers.get('retry-after') || '';
                if (error.code === this.humanGateCode) {
                    this.redirectToHumanGate();
                }
                throw error;
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    }

    async get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return this.request(url, { method: 'GET' });
    }

    async post(endpoint, body) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(body)
        });
    }

    async put(endpoint, body) {
        return this.request(endpoint, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    async upload(endpoint, formData) {
        const token = localStorage.getItem('token');
        const headers = {};
        
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
        }

        const response = await fetch(this.baseURL + endpoint, {
            method: 'POST',
            headers,
            body: formData,
            credentials: 'include'
        });

        if (this.isBlockedIpResponse(response)) {
            this.redirectToBlockedIp(response);
            throw new Error('IP cua ban dang bi khoa tam thoi');
        }

        const data = await response.json();
        if (data?.code === this.humanGateCode) {
            this.redirectToHumanGate();
            throw new Error(data.message || 'Vui long xac nhan ban la nguoi that');
        }

        return data;
    }

    uploadWithProgress(endpoint, formData, onProgress) {
        const token = localStorage.getItem('token');
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('POST', this.baseURL + endpoint, true);
            xhr.withCredentials = true;
            if (token) {
                xhr.setRequestHeader('Authorization', `Bearer ${token}`);
            }

            xhr.upload.addEventListener('progress', (event) => {
                if (!event.lengthComputable) return;
                const percent = Math.round((event.loaded / event.total) * 100);
                if (typeof onProgress === 'function') {
                    onProgress(percent);
                }
            });

            xhr.onload = () => {
                try {
                    const responseURL = xhr.responseURL ? new URL(xhr.responseURL, window.location.origin) : null;
                    if (responseURL && responseURL.pathname === this.blockedIpPath) {
                        window.location.replace(`${responseURL.pathname}${responseURL.search}${responseURL.hash}`);
                        reject(new Error('IP cua ban dang bi khoa tam thoi'));
                        return;
                    }

                    const data = JSON.parse(xhr.responseText || '{}');
                    if (data?.code === this.humanGateCode) {
                        this.redirectToHumanGate();
                        reject(new Error(data.message || 'Vui long xac nhan ban la nguoi that'));
                        return;
                    }
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve(data);
                    } else {
                        reject(new Error(data.message || 'Upload failed'));
                    }
                } catch (error) {
                    reject(error);
                }
            };

            xhr.onerror = () => {
                reject(new Error('Upload failed'));
            };

            xhr.send(formData);
        });
    }
}

const api = new APIClient(API_BASE_URL);

