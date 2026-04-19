const RecaptchaManager = (() => {
    let configPromise = null;
    let turnstilePromise = null;
    const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    const TURNSTILE_SCRIPT_SELECTOR = 'script[data-turnstile-api="1"]';

    async function getConfig(forceRefresh = false) {
        if (forceRefresh) {
            configPromise = null;
        }

        if (!configPromise) {
            configPromise = api.get('/auth/recaptcha-config')
                .then((response) => {
                    const data = response?.data || {};
                    return {
                        enabled: Boolean(data.enabled),
                        siteKey: String(data.siteKey || '').trim()
                    };
                })
                .catch((error) => {
                    configPromise = null;
                    throw error;
                });
        }

        return configPromise;
    }

    function removeRecaptchaScripts() {
        document.querySelectorAll(`${TURNSTILE_SCRIPT_SELECTOR}, script[src*="turnstile"]`)
            .forEach((node) => node.remove());
    }

    function ensureRecaptchaScript(forceReload = false) {
        if (forceReload) {
            turnstilePromise = null;
            removeRecaptchaScripts();
            if (window.turnstile) {
                try { delete window.turnstile; } catch (_) { window.turnstile = undefined; }
            }
        }

        let script = document.querySelector(TURNSTILE_SCRIPT_SELECTOR);
        if (!script) {
            script = document.createElement('script');
            script.src = TURNSTILE_SCRIPT_SRC;
            script.async = true;
            script.defer = true;
            script.setAttribute('data-turnstile-api', '1');
            document.head.appendChild(script);
        }

        return script;
    }

    function waitForTurnstile(timeoutMs = 15000, forceReload = false) {
        if (window.turnstile && typeof window.turnstile.render === 'function') {
            return Promise.resolve(window.turnstile);
        }

        ensureRecaptchaScript(forceReload);

        if (turnstilePromise) {
            return turnstilePromise;
        }

        turnstilePromise = new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const timer = setInterval(() => {
                if (window.turnstile && typeof window.turnstile.render === 'function') {
                    clearInterval(timer);
                    resolve(window.turnstile);
                    return;
                }

                if (Date.now() - startedAt >= timeoutMs) {
                    clearInterval(timer);
                    turnstilePromise = null;
                    reject(new Error('Khong tai duoc Turnstile. Vui long tai lai trang.'));
                }
            }, 100);
        }).catch((error) => {
            turnstilePromise = null;
            throw error;
        });

        return turnstilePromise;
    }

    async function render(target, options = {}) {
        const container = typeof target === 'string' ? document.getElementById(target) : target;
        if (!container) {
            throw new Error('Khong tim thay o hien thi reCAPTCHA.');
        }

        const config = await getConfig(options.forceReload === true);
        if (!config.enabled || !config.siteKey) {
            container.classList.add('is-hidden');
            container.innerHTML = '';
            return {
                enabled: false,
                widgetId: null
            };
        }

        const turnstile = await waitForTurnstile(15000, options.forceReload === true);
        container.classList.remove('is-hidden');
        container.innerHTML = '';

        let widgetId = null;
        try {
            widgetId = turnstile.render(container, {
                sitekey: config.siteKey,
                size: 'normal'
            });
        } catch (error) {
            if (!options.forceReload) {
                return render(container, { forceReload: true });
            }
            throw error;
        }

        return {
            enabled: true,
            widgetId
        };
    }

    function getResponse(widgetId) {
        if (!widgetId) {
            return '';
        }

        if (!window.turnstile || typeof window.turnstile.getResponse !== 'function') {
            return '';
        }

        return window.turnstile.getResponse(widgetId) || '';
    }

    function reset(widgetId) {
        if (!widgetId) {
            return;
        }

        if (!window.turnstile || typeof window.turnstile.reset !== 'function') {
            return;
        }

        window.turnstile.reset(widgetId);
    }

    return {
        getConfig,
        getResponse,
        render,
        reset
    };
})();

window.RecaptchaManager = RecaptchaManager;
