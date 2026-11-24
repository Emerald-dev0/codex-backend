/**
 * Admin › Settings › Maintenance mode. While enabled, product APIs answer 503
 * so users see a consistent "scheduled maintenance" state. Auth, the admin
 * panel, payment webhooks and support stay reachable so staff can operate
 * the platform and providers do not accumulate failed deliveries.
 */
const { getSettings } = require('../utils/platformSettings');

const ALWAYS_ALLOWED = [
    /^\/api\/admin(\/|$)/,
    /^\/api\/auth(\/|$)/,
    /^\/api\/otp(\/|$)/,
    /^\/api\/support(\/|$)/,
    /^\/api\/health$/,
    // Payment provider webhooks (any billing rail): never drop deliveries.
    /\/webhooks?(\/|$)/,
];

function isAllowed(path) {
    return ALWAYS_ALLOWED.some((re) => re.test(path));
}

async function maintenanceMode(req, res, next) {
    const path = req.originalUrl ? req.originalUrl.split('?')[0] : req.path;
    if (!path.startsWith('/api/') || isAllowed(path)) return next();
    let settings;
    try {
        settings = await getSettings();
    } catch {
        return next();
    }
    if (!settings.registration.maintenanceMode) return next();
    res.setHeader('Retry-After', '600');
    return res.status(503).json({
        success: false,
        message: `${settings.general.platformName} is undergoing scheduled maintenance. Please try again shortly.`,
        code: 'MAINTENANCE_MODE',
    });
}

module.exports = { maintenanceMode, isAllowed };
