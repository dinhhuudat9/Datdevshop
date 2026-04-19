const querystring = require('querystring');

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'];
const INTERNAL_ORIGIN = 'http://next-http.local';
const routeCache = new Map();

function escapeRegExp(value = '') {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(value = '/') {
    const input = String(value || '/').trim() || '/';
    const withSlash = input.startsWith('/') ? input : `/${input}`;
    if (withSlash === '/') {
        return '/';
    }
    return withSlash.replace(/\/+$/, '') || '/';
}

function parseQuery(searchParams) {
    const query = {};
    for (const [key, value] of searchParams.entries()) {
        if (Object.prototype.hasOwnProperty.call(query, key)) {
            const current = query[key];
            query[key] = Array.isArray(current) ? [...current, value] : [current, value];
            continue;
        }
        query[key] = value;
    }
    return query;
}

function parseCookies(header = '') {
    return String(header || '')
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const separatorIndex = part.indexOf('=');
            const key = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
            const rawValue = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '';

            try {
                acc[key] = decodeURIComponent(rawValue);
            } catch (_) {
                acc[key] = rawValue;
            }

            return acc;
        }, {});
}

function serializeCookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(String(value ?? ''))}`];

    if (options.maxAge !== undefined) {
        const maxAgeMs = Number(options.maxAge);
        if (Number.isFinite(maxAgeMs)) {
            const maxAgeSeconds = Math.max(Math.floor(maxAgeMs / 1000), 0);
            parts.push(`Max-Age=${maxAgeSeconds}`);
            parts.push(`Expires=${new Date(Date.now() + maxAgeMs).toUTCString()}`);
        }
    }

    if (options.domain) {
        parts.push(`Domain=${options.domain}`);
    }

    if (options.path) {
        parts.push(`Path=${options.path}`);
    }

    if (options.expires instanceof Date) {
        parts.push(`Expires=${options.expires.toUTCString()}`);
    }

    if (options.httpOnly) {
        parts.push('HttpOnly');
    }

    if (options.secure) {
        parts.push('Secure');
    }

    if (options.sameSite) {
        const sameSite = String(options.sameSite).toLowerCase();
        const normalized = sameSite === 'strict'
            ? 'Strict'
            : sameSite === 'none'
                ? 'None'
                : 'Lax';
        parts.push(`SameSite=${normalized}`);
    }

    return parts.join('; ');
}

function appendHeader(res, key, value) {
    const existing = res.getHeader(key);
    if (!existing) {
        res.setHeader(key, value);
        return;
    }

    if (Array.isArray(existing)) {
        res.setHeader(key, [...existing, value]);
        return;
    }

    res.setHeader(key, [existing, value]);
}

function appendVary(res, value) {
    const existing = String(res.getHeader('Vary') || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (!existing.includes(value)) {
        res.setHeader('Vary', [...existing, value].join(', '));
    }
}

function updateRequestState(req, url) {
    const absoluteUrl = new URL(String(url || '/'), INTERNAL_ORIGIN);
    req.url = `${absoluteUrl.pathname}${absoluteUrl.search}`;
    req.path = normalizePath(absoluteUrl.pathname);
    req.query = parseQuery(absoluteUrl.searchParams);
}

function buildRequestProtocol(req) {
    const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '')
        .split(',')[0]
        .trim()
        .toLowerCase();

    if (forwardedProto) {
        return forwardedProto;
    }

    if (req.socket?.encrypted) {
        return 'https';
    }

    return 'http';
}

function buildRequestUrl(req) {
    const host = String(req.headers?.host || 'localhost');
    return `${buildRequestProtocol(req)}://${host}${req.originalUrl || req.url || '/'}`;
}

function prepareRequest(req, app) {
    if (!req.originalUrl) {
        req.originalUrl = req.url || '/';
    }

    if (!req.baseUrl) {
        req.baseUrl = '';
    }

    if (!req.protocol) {
        req.protocol = buildRequestProtocol(req);
    }

    req.secure = req.protocol === 'https';
    req.app = app;
    req.get = req.get || ((name) => req.headers?.[String(name || '').toLowerCase()]);
    req.header = req.header || req.get;
    req.cookies = req.cookies || {};

    updateRequestState(req, req.url || '/');

    if (!req.ip) {
        req.ip = req.socket?.remoteAddress || '';
    }
}

function prepareResponse(res) {
    if (res.locals === undefined) {
        res.locals = {};
    }

    if (!res.status) {
        res.status = (code) => {
            res.statusCode = code;
            return res;
        };
    }

    if (!res.set) {
        res.set = (field, value) => {
            if (field && typeof field === 'object') {
                Object.entries(field).forEach(([key, item]) => res.setHeader(key, item));
                return res;
            }

            res.setHeader(field, value);
            return res;
        };
    }

    if (!res.get) {
        res.get = (field) => res.getHeader(field);
    }

    if (!res.send) {
        res.send = (payload) => {
            if (payload === undefined) {
                res.end();
                return res;
            }

            if (Buffer.isBuffer(payload)) {
                res.end(payload);
                return res;
            }

            if (typeof payload === 'object') {
                if (!res.getHeader('Content-Type')) {
                    res.setHeader('Content-Type', 'application/json; charset=utf-8');
                }
                res.end(JSON.stringify(payload));
                return res;
            }

            if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            }

            res.end(String(payload));
            return res;
        };
    }

    if (!res.json) {
        res.json = (payload) => {
            if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
            res.end(JSON.stringify(payload));
            return res;
        };
    }

    if (!res.redirect) {
        res.redirect = (statusOrLocation, maybeLocation) => {
            const statusCode = maybeLocation ? Number(statusOrLocation) : 302;
            const location = maybeLocation || statusOrLocation;
            res.statusCode = Number.isFinite(statusCode) ? statusCode : 302;
            res.setHeader('Location', String(location || '/'));
            res.end();
            return res;
        };
    }

    if (!res.cookie) {
        res.cookie = (name, value, options = {}) => {
            appendHeader(res, 'Set-Cookie', serializeCookie(name, value, options));
            return res;
        };
    }
}

function getRawBody(req) {
    if (req._rawBodyPromise) {
        return req._rawBodyPromise;
    }

    req._rawBodyPromise = (async () => {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        req.rawBody = Buffer.concat(chunks);
        return req.rawBody;
    })();

    return req._rawBodyPromise;
}

function json() {
    return async (req, res, next) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/json') || ['GET', 'HEAD'].includes(req.method)) {
            return next();
        }

        if (req.body !== undefined) {
            return next();
        }

        try {
            const rawBody = await getRawBody(req);
            if (!rawBody.length) {
                req.body = {};
                return next();
            }

            req.body = JSON.parse(rawBody.toString('utf8'));
            return next();
        } catch (error) {
            error.statusCode = 400;
            error.message = 'Invalid JSON payload';
            return next(error);
        }
    };
}

function urlencoded() {
    return async (req, res, next) => {
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (!contentType.includes('application/x-www-form-urlencoded') || ['GET', 'HEAD'].includes(req.method)) {
            return next();
        }

        if (req.body !== undefined) {
            return next();
        }

        try {
            const rawBody = await getRawBody(req);
            req.body = querystring.parse(rawBody.toString('utf8'));
            return next();
        } catch (error) {
            error.statusCode = 400;
            error.message = 'Invalid form payload';
            return next(error);
        }
    };
}

function cookieParser() {
    return (req, res, next) => {
        req.cookies = parseCookies(req.headers.cookie || '');
        next();
    };
}

function cors(delegate) {
    return async (req, res, next) => {
        try {
            const options = await new Promise((resolve, reject) => {
                delegate(req, (error, value) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(value || {});
                });
            });

            const requestOrigin = String(req.headers.origin || '').trim();
            const allowedOrigin = options.origin === true ? requestOrigin : options.origin;

            if (allowedOrigin) {
                res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
                appendVary(res, 'Origin');
            }

            if (options.credentials) {
                res.setHeader('Access-Control-Allow-Credentials', 'true');
            }

            if (req.method === 'OPTIONS') {
                const allowHeaders = req.headers['access-control-request-headers']
                    || 'Content-Type, Authorization, X-Requested-With, X-Asset-Session-Id, X-Client-Public-IP, X-API-Key';
                res.setHeader('Access-Control-Allow-Headers', allowHeaders);
                res.setHeader('Access-Control-Allow-Methods', METHODS.join(', '));
                res.statusCode = 204;
                res.end();
                return;
            }

            next();
        } catch (error) {
            next(error);
        }
    };
}

function flattenHandlers(handlers = []) {
    return handlers.flatMap((handler) => Array.isArray(handler) ? flattenHandlers(handler) : [handler])
        .filter(Boolean);
}

function compileRoute(pathname) {
    const normalized = pathname === '*'
        ? '*'
        : normalizePath(pathname);

    const cacheKey = `route:${normalized}`;
    if (routeCache.has(cacheKey)) {
        return routeCache.get(cacheKey);
    }

    if (normalized === '*') {
        const compiled = {
            path: normalized,
            keys: [],
            regex: /^.*$/
        };
        routeCache.set(cacheKey, compiled);
        return compiled;
    }

    const segments = normalized.split('/').filter(Boolean);
    const keys = [];
    let source = '^';

    if (!segments.length) {
        source += '/';
    }

    segments.forEach((segment) => {
        if (segment.startsWith(':')) {
            keys.push(segment.slice(1));
            source += '/([^/]+)';
            return;
        }

        source += `/${escapeRegExp(segment)}`;
    });

    source += '/?$';

    const compiled = {
        path: normalized,
        keys,
        regex: new RegExp(source)
    };
    routeCache.set(cacheKey, compiled);
    return compiled;
}

function matchRoute(compiled, pathname) {
    const normalizedPath = normalizePath(pathname);
    const match = compiled.regex.exec(normalizedPath);
    if (!match) {
        return null;
    }

    return compiled.keys.reduce((params, key, index) => {
        try {
            params[key] = decodeURIComponent(match[index + 1]);
        } catch (_) {
            params[key] = match[index + 1];
        }
        return params;
    }, {});
}

function matchPrefix(prefix, pathname) {
    const normalizedPrefix = normalizePath(prefix);
    const normalizedPath = normalizePath(pathname);

    if (normalizedPrefix === '/') {
        return {
            matched: '',
            rest: normalizedPath
        };
    }

    if (normalizedPath === normalizedPrefix) {
        return {
            matched: normalizedPrefix,
            rest: '/'
        };
    }

    if (normalizedPath.startsWith(`${normalizedPrefix}/`)) {
        return {
            matched: normalizedPrefix,
            rest: normalizedPath.slice(normalizedPrefix.length) || '/'
        };
    }

    return null;
}

function isErrorHandler(handler) {
    return typeof handler === 'function' && handler.length >= 4;
}

class NextRouter {
    constructor() {
        this.stack = [];
        this.settings = new Map();
        this.__isNextRouter = true;
    }

    set(key, value) {
        this.settings.set(key, value);
        return this;
    }

    get(key) {
        return this.settings.get(key);
    }

    use(pathOrHandler, ...rest) {
        const hasExplicitPath = typeof pathOrHandler === 'string';
        const path = hasExplicitPath ? pathOrHandler : '/';
        const handlers = hasExplicitPath ? rest : [pathOrHandler, ...rest];

        flattenHandlers(handlers).forEach((handler) => {
            this.stack.push({
                kind: handler?.__isNextRouter ? 'router' : (isErrorHandler(handler) ? 'error' : 'middleware'),
                path: normalizePath(path),
                handler
            });
        });

        return this;
    }

    register(method, path, handlers) {
        const compiled = compileRoute(path);
        flattenHandlers(handlers).forEach((handler) => {
            this.stack.push({
                kind: isErrorHandler(handler) ? 'error' : 'route',
                method,
                path: compiled.path,
                compiled,
                handler
            });
        });
        return this;
    }

    async handle(req, res, out, initialError) {
        prepareRequest(req, this);
        prepareResponse(res);

        let index = 0;
        const stack = this.stack;

        const dispatch = async (error) => {
            if (res.writableEnded) {
                return;
            }

            while (index < stack.length) {
                const layer = stack[index++];

                if (error && layer.kind !== 'error') {
                    continue;
                }

                if (!error && layer.kind === 'error') {
                    continue;
                }

                if (layer.kind === 'route' && layer.method !== req.method) {
                    continue;
                }

                if (layer.kind === 'route') {
                    const params = matchRoute(layer.compiled, req.path);
                    if (!params) {
                        continue;
                    }

                    return this.invokeHandler(layer.handler, req, res, dispatch, {
                        params,
                        error
                    });
                }

                const prefixMatch = matchPrefix(layer.path, req.path);
                if (!prefixMatch) {
                    continue;
                }

                if (layer.kind === 'router') {
                    return this.invokeRouter(layer.handler, req, res, dispatch, prefixMatch, error);
                }

                return this.invokeHandler(layer.handler, req, res, dispatch, {
                    prefixMatch,
                    error
                });
            }

            if (typeof out === 'function') {
                return out(error);
            }

            if (error) {
                console.error('Unhandled API error:', error);
                if (!res.writableEnded) {
                    res.status(error.statusCode || 500).json({
                        success: false,
                        message: error.message || 'Internal Server Error'
                    });
                }
                return;
            }

            if (!res.writableEnded) {
                res.status(404).json({
                    success: false,
                    message: 'Not found'
                });
            }
        };

        await dispatch(initialError);
    }

    async invokeRouter(router, req, res, dispatch, prefixMatch, error) {
        const restore = this.applyMount(req, prefixMatch);
        let restored = false;
        const finish = () => {
            if (restored) {
                return;
            }
            restored = true;
            restore();
        };

        await router.handle(
            req,
            res,
            async (nextError) => {
                finish();
                return dispatch(nextError);
            },
            error
        );

        finish();
    }

    async invokeHandler(handler, req, res, dispatch, context) {
        const restoreMount = context.prefixMatch
            ? this.applyMount(req, context.prefixMatch)
            : () => {};
        const previousParams = req.params;
        if (context.params) {
            req.params = context.params;
        }

        let finished = false;
        const finish = () => {
            if (finished) {
                return;
            }
            finished = true;
            restoreMount();
            req.params = previousParams;
        };

        const next = async (nextError) => {
            finish();
            return dispatch(nextError);
        };

        try {
            if (context.error && isErrorHandler(handler)) {
                await handler(context.error, req, res, next);
            } else {
                await handler(req, res, next);
            }
        } catch (error) {
            finish();
            return dispatch(error);
        }

        finish();
    }

    applyMount(req, prefixMatch) {
        const previousState = {
            url: req.url,
            path: req.path,
            query: req.query,
            baseUrl: req.baseUrl
        };

        const searchIndex = String(req.url || '').indexOf('?');
        const search = searchIndex >= 0 ? String(req.url).slice(searchIndex) : '';
        const nextBaseUrl = `${req.baseUrl || ''}${prefixMatch.matched}` || '';

        req.baseUrl = nextBaseUrl === '/' ? '' : nextBaseUrl;
        updateRequestState(req, `${prefixMatch.rest || '/'}${search}`);

        return () => {
            req.baseUrl = previousState.baseUrl;
            req.url = previousState.url;
            req.path = previousState.path;
            req.query = previousState.query;
        };
    }
}

function createApp() {
    return new NextRouter();
}

function createRouter() {
    return new NextRouter();
}

METHODS.forEach((method) => {
    const name = method.toLowerCase();
    NextRouter.prototype[name] = function registerRoute(path, ...handlers) {
        return this.register(method, path, handlers);
    };
});

module.exports = {
    buildRequestUrl,
    cookieParser,
    cors,
    createApp,
    createRouter,
    getRawBody,
    json,
    urlencoded
};
