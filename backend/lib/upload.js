const fs = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { buildRequestUrl } = require('./nextHttp');

function createUploadError(message, statusCode = 400, code = '') {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) {
        error.code = code;
    }
    return error;
}

function collectTextFields(formData) {
    const fields = {};
    for (const [key, value] of formData.entries()) {
        if (typeof value !== 'string') {
            continue;
        }

        if (Object.prototype.hasOwnProperty.call(fields, key)) {
            const current = fields[key];
            fields[key] = Array.isArray(current) ? [...current, value] : [current, value];
            continue;
        }

        fields[key] = value;
    }

    return fields;
}

async function parseFormData(req) {
    if (req._multipartFormData !== undefined) {
        return req._multipartFormData;
    }

    if (['GET', 'HEAD'].includes(req.method)) {
        req._multipartFormData = null;
        return null;
    }

    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
        req._multipartFormData = null;
        return null;
    }

    const request = new Request(buildRequestUrl(req), {
        method: req.method,
        headers: new Headers(req.headers),
        body: Readable.toWeb(req),
        duplex: 'half'
    });

    req._multipartFormData = await request.formData();
    return req._multipartFormData;
}

function singleFileUpload(options = {}) {
    const fieldName = options.fieldName || 'file';
    const allowedMimeTypes = Array.isArray(options.allowedMimeTypes) ? options.allowedMimeTypes : [];
    const maxFileSize = Number(options.maxFileSize || 0);

    return async (req, res, next) => {
        try {
            const formData = await parseFormData(req);
            if (!formData) {
                return next();
            }

            req.body = {
                ...(req.body && typeof req.body === 'object' ? req.body : {}),
                ...collectTextFields(formData)
            };

            const file = formData.get(fieldName);
            if (!file || typeof file === 'string') {
                req.file = null;
                return next();
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            const mimetype = String(file.type || '').toLowerCase();
            const originalname = String(file.name || `upload-${Date.now()}`);
            const size = buffer.length;

            if (maxFileSize && size > maxFileSize) {
                return next(createUploadError('File too large', 400, 'LIMIT_FILE_SIZE'));
            }

            if (allowedMimeTypes.length && !allowedMimeTypes.includes(mimetype)) {
                return next(createUploadError('File type not allowed', 400));
            }

            req.file = {
                buffer,
                size,
                mimetype,
                originalname
            };

            if (options.storage === 'disk') {
                const destination = await options.destination(req, req.file);
                const filename = await options.filename(req, req.file);
                const filePath = path.join(destination, filename);

                await fs.mkdir(destination, { recursive: true });
                await fs.writeFile(filePath, buffer);

                req.file = {
                    ...req.file,
                    destination,
                    filename,
                    path: filePath
                };
            }

            return next();
        } catch (error) {
            return next(createUploadError(error.message || 'Upload failed', error.statusCode || 400, error.code));
        }
    };
}

module.exports = {
    singleFileUpload
};
