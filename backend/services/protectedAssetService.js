const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FRONTEND_ROOT = path.join(__dirname, '../../frontend');
const ASSET_SESSION_TTL_MS = parseInt(process.env.ASSET_SESSION_TTL_MS || '900000', 10);
const ASSET_COOKIE_NAME = 'asset_guard_sid';
const assetSessions = new Map();

function normalizeAssetPath(requestedPath = '') {
    const normalized = path.posix.normalize(`/${String(requestedPath || '').replace(/\\/g, '/').replace(/^\/+/, '')}`);
    if (normalized.includes('..')) {
        throw new Error('Invalid asset path');
    }
    return normalized;
}

function isAllowedAssetPath(assetPath) {
    return (
        (assetPath.startsWith('/pages/') && assetPath.endsWith('.html')) ||
        (assetPath.startsWith('/css/') && assetPath.endsWith('.css'))
    );
}

function resolveAssetPath(assetPath) {
    const relativePath = assetPath.replace(/^\/+/, '');
    return path.join(FRONTEND_ROOT, ...relativePath.split('/'));
}

function minifyHtml(html = '') {
    return String(html || '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .trim();
}

function minifyCss(css = '') {
    return String(css || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function encodeContent(content = '', assetKey = '') {
    const source = Buffer.from(String(content || ''), 'utf8');
    const key = Buffer.from(String(assetKey || ''), 'utf8');
    const encoded = Buffer.allocUnsafe(source.length);

    for (let index = 0; index < source.length; index += 1) {
        encoded[index] = source[index] ^ key[index % key.length];
    }

    return encoded.toString('base64');
}

function buildAssetPayload(assetPath, rawContent, assetKey) {
    const isHtml = assetPath.endsWith('.html');
    const content = isHtml ? minifyHtml(rawContent) : minifyCss(rawContent);

    return {
        assetPath,
        mimeType: isHtml ? 'text/html' : 'text/css',
        payload: encodeContent(content, assetKey)
    };
}

function cleanupExpiredSessions(now = Date.now()) {
    assetSessions.forEach((session, sessionId) => {
        if (!session.expiresAt || session.expiresAt <= now) {
            assetSessions.delete(sessionId);
        }
    });
}

function issueAssetSession() {
    const now = Date.now();
    cleanupExpiredSessions(now);

    const sessionId = crypto.randomBytes(18).toString('hex');
    const assetKey = crypto.randomBytes(24).toString('base64url');
    const expiresAt = now + ASSET_SESSION_TTL_MS;

    assetSessions.set(sessionId, {
        assetKey,
        expiresAt
    });

    return {
        sessionId,
        assetKey,
        expiresAt
    };
}

function getActiveAssetSession(sessionId = '') {
    cleanupExpiredSessions();

    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) {
        return null;
    }

    const session = assetSessions.get(normalizedSessionId);
    if (!session) {
        return null;
    }

    if (!session.expiresAt || session.expiresAt <= Date.now()) {
        assetSessions.delete(normalizedSessionId);
        return null;
    }

    return session;
}

function getProtectedAsset(requestedPath, sessionId) {
    const assetPath = normalizeAssetPath(requestedPath);
    if (!isAllowedAssetPath(assetPath)) {
        const error = new Error('Asset is not allowed');
        error.statusCode = 404;
        throw error;
    }

    const filesystemPath = resolveAssetPath(assetPath);
    if (!filesystemPath.startsWith(FRONTEND_ROOT)) {
        const error = new Error('Asset is not allowed');
        error.statusCode = 404;
        throw error;
    }

    if (!fs.existsSync(filesystemPath)) {
        const error = new Error('Asset not found');
        error.statusCode = 404;
        throw error;
    }

    const session = getActiveAssetSession(sessionId);
    if (!session?.assetKey) {
        const error = new Error('Asset key is required');
        error.statusCode = 403;
        throw error;
    }

    const rawContent = fs.readFileSync(filesystemPath, 'utf8');
    return buildAssetPayload(assetPath, rawContent, session.assetKey);
}

module.exports = {
    ASSET_COOKIE_NAME,
    ASSET_SESSION_TTL_MS,
    getProtectedAsset,
    issueAssetSession
};
