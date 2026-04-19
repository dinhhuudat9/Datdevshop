const PublicIpManager = (() => {
    const STORAGE_KEY = 'public_ip_cache_v1';
    const IPLOCATION_URL = 'https://api.iplocation.net/?cmd=get-ip';
    const CACHE_TTL_MS = 10 * 60 * 1000;
    let ipPromise = null;

    function readCache() {
        try {
            const raw = sessionStorage.getItem(STORAGE_KEY);
            if (!raw) {
                return '';
            }

            const parsed = JSON.parse(raw);
            if (!parsed?.ip || !parsed?.cachedAt) {
                return '';
            }

            if (Date.now() - Number(parsed.cachedAt) > CACHE_TTL_MS) {
                sessionStorage.removeItem(STORAGE_KEY);
                return '';
            }

            return String(parsed.ip || '').trim();
        } catch (_) {
            return '';
        }
    }

    function writeCache(ip) {
        const safeIp = String(ip || '').trim();
        if (!safeIp) {
            return safeIp;
        }

        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                ip: safeIp,
                cachedAt: Date.now()
            }));
        } catch (_) {
            // ignore storage failures
        }

        return safeIp;
    }

    async function getPublicIp(forceRefresh = false) {
        if (!forceRefresh) {
            const cachedIp = readCache();
            if (cachedIp) {
                return cachedIp;
            }
        }

        if (!forceRefresh && ipPromise) {
            return ipPromise;
        }

        ipPromise = fetch(IPLOCATION_URL, {
            method: 'GET',
            mode: 'cors',
            cache: 'no-store'
        })
            .then(async (response) => {
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const payload = await response.json();
                const ip = String(payload?.ip || '').trim();
                if (!ip) {
                    throw new Error('IP not found');
                }

                return writeCache(ip);
            })
            .catch((error) => {
                ipPromise = null;
                throw error;
            });

        return ipPromise;
    }

    function warmup() {
        void getPublicIp().catch(() => {});
    }

    return {
        getPublicIp,
        warmup
    };
})();

window.PublicIpManager = PublicIpManager;
