/**
 * Platform-admin authorization for the admin panel (/api/admin/*).
 *
 * Builds on authenticateToken (signature, liveness, ban and tokenVersion
 * checks) and then re-reads `platformRole` from the database on every
 * request. The role is never trusted from the token, so demoting an admin
 * takes effect on their very next call.
 */
const rateLimit = require('express-rate-limit');
const { authenticateToken } = require('./auth');

const ROLE_RANK = Object.freeze({ admin: 1, super_admin: 2 });

function roleRank(role) {
    return ROLE_RANK[role] || 0;
}

function isPlatformAdminRole(role) {
    return roleRank(role) > 0;
}

function toAdminView(user) {
    return {
        id: String(user._id),
        fullName: user.fullName || '',
        email: user.email || '',
        role: user.platformRole,
        profilePicture: user.profilePicture || null,
        authProvider: user.authProvider || 'local',
        totpEnabled: Boolean(user.twoFactor?.totpEnabled),
    };
}

const SESSION_TOUCH_INTERVAL_MS = 30 * 1000;

function sessionExpired(res, message = 'Your admin session has expired. Please sign in again.') {
    return res.status(401).json({ success: false, message, code: 'ADMIN_SESSION_EXPIRED' });
}

/**
 * Validate the server-side admin session bound to an admin-scoped JWT and
 * enforce the idle timeout configured in Admin › Settings › Security.
 */
async function checkAdminSession(req, res) {
    const payload = req.user || {};
    if (payload.scope !== 'admin' || typeof payload.sid !== 'string') {
        sessionExpired(res, 'Sign in to the admin panel to continue.');
        return null;
    }
    const AdminSession = require('../models/AdminSession');
    const session = await AdminSession.findOne({ sid: payload.sid }).lean();
    const now = Date.now();
    if (!session || session.revokedAt || String(session.userId) !== String(req.userId) || new Date(session.expiresAt).getTime() <= now) {
        sessionExpired(res);
        return null;
    }
    const { getSettings } = require('../utils/platformSettings');
    const settings = await getSettings();
    const idleMs = (Number(settings.security.sessionTimeoutMinutes) || 30) * 60 * 1000;
    const lastSeen = new Date(session.lastSeenAt || session.createdAt).getTime();
    if (now - lastSeen > idleMs) {
        await AdminSession.updateOne({ _id: session._id }, { $set: { revokedAt: new Date() } });
        sessionExpired(res, 'You were signed out after a period of inactivity.');
        return null;
    }
    if (now - lastSeen > SESSION_TOUCH_INTERVAL_MS) {
        await AdminSession.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } });
    }
    return session;
}

async function loadAdmin(req, res, next) {
    try {
        const session = await checkAdminSession(req, res);
        if (!session) return undefined;
        const User = require('../models/User');
        let query = User.findById(req.userId);
        if (query && typeof query.select === 'function') {
            query = query.select('fullName email platformRole profilePicture authProvider isBanned twoFactor.totpEnabled');
        }
        if (query && typeof query.lean === 'function') query = query.lean();
        const user = await query;
        if (!user || user.isBanned || !isPlatformAdminRole(user.platformRole)) {
            return res.status(403).json({
                success: false,
                message: 'Admin access required',
                code: 'NOT_PLATFORM_ADMIN',
            });
        }
        req.admin = toAdminView(user);
        req.admin.platformRole = user.platformRole;
        req.adminSession = { sid: session.sid, lastSeenAt: session.lastSeenAt };
        return next();
    } catch (error) {
        console.error('[platform-admin] role lookup failed:', error.message);
        // Fail closed.
        return res.status(503).json({ success: false, message: 'Could not verify admin access', code: 'ADMIN_CHECK_FAILED' });
    }
}

function requireRole(minRole) {
    return (req, res, next) => {
        if (!req.admin || roleRank(req.admin.role) < roleRank(minRole)) {
            return res.status(403).json({
                success: false,
                message: 'Super admin access required for this action',
                code: 'INSUFFICIENT_ADMIN_ROLE',
            });
        }
        return next();
    };
}

/** Middleware chain: authenticated + any platform admin role. */
const requirePlatformAdmin = [authenticateToken, loadAdmin];

/** Middleware chain: authenticated + super_admin. */
const requireSuperAdmin = [authenticateToken, loadAdmin, requireRole('super_admin')];

// The UI issues several reads per screen; the static-key limiter (10/15min)
// is far too low for that. Still bounded per IP.
const adminPanelLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 900,
    standardHeaders: true,
    legacyHeaders: false,
    store: require('../utils/redis').getRateLimitStore('admin-panel'),
    passOnStoreError: true,
    message: { success: false, message: 'Too many requests, please slow down.' },
});

module.exports = {
    ROLE_RANK,
    roleRank,
    isPlatformAdminRole,
    toAdminView,
    loadAdmin,
    checkAdminSession,
    requireRole,
    requirePlatformAdmin,
    requireSuperAdmin,
    adminPanelLimiter,
};
