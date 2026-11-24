/**
 * Response helpers for the admin panel routers. Authored service errors
 * (statusCode + code) keep their message — including 502/503 provider
 * failures, whose messages are written by us, never raw provider bodies.
 * Anything else goes through sendError/sendInternalError.
 */
const { sendError, sendInternalError } = require('../httpErrors');

function ok(res, data, extra = {}) {
    return res.json({ success: true, data, ...extra });
}

function fail(req, res, error, fallback = 'Something went wrong. Please try again.') {
    const status = Number(error?.statusCode);
    if (Number.isInteger(status) && status >= 400 && status < 500) return sendError(req, res, error);
    if (Number.isInteger(status) && status >= 500 && typeof error.code === 'string' && error.code !== 'INTERNAL_ERROR') {
        return res.status(status).json({ success: false, message: error.message, code: error.code, ...(req.id ? { requestId: req.id } : {}) });
    }
    if (error?.name === 'ValidationError' || error?.name === 'CastError' || error?.code === 11000) return sendError(req, res, error);
    return sendInternalError(req, res, error, { message: fallback });
}

/** Wrap an async handler: `route(async (req) => data)`. */
function route(handler, fallback) {
    return async (req, res) => {
        try {
            const data = await handler(req, res);
            if (res.headersSent) return undefined;
            return ok(res, data);
        } catch (error) {
            return fail(req, res, error, fallback);
        }
    };
}

module.exports = { ok, fail, route };
