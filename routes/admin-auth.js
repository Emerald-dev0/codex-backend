/**
 * Admin panel authentication and the signed-in admin's own account.
 *
 *   POST /api/admin/auth/login         email + password (platform admins only)
 *   POST /api/admin/auth/verify-2fa    second factor when required
 *   POST /api/admin/auth/resend-2fa    resend an email code
 *   POST /api/admin/auth/logout        revoke this admin session
 *   GET  /api/admin/me                 current admin + session policy
 *   POST /api/admin/me/email/request   start an email change (code to new address)
 *   POST /api/admin/me/email/confirm   finish an email change
 *   POST /api/admin/me/2fa/totp/setup|confirm|disable  authenticator app
 *
 * Profile name/photo and password reuse /api/auth/update-profile,
 * /api/auth/upload-photo and /api/auth/change-password with the admin token.
 */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const AdminSession = require('../models/AdminSession');
const TwoFactorChallenge = require('../models/TwoFactorChallenge');
const { isLockedOut, recordFailure, clearLockout } = require('../models/AuthLockout');
const { normalizeTokenVersion } = require('../middleware/auth');
const { requirePlatformAdmin, isPlatformAdminRole, toAdminView } = require('../middleware/platformAdmin');
const { getSettings } = require('../utils/platformSettings');
const twoFactor = require('../utils/twoFactor');
const { recordAdminAction } = require('../utils/adminAudit');
const { sendError, sendInternalError } = require('../utils/httpErrors');
const adminHttp = require('../utils/admin/http');

const router = express.Router();
const ADMIN_SESSION_MAX_MS = 12 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const adminAuthLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: process.env.NODE_ENV === 'test' ? 10000 : 20,
    standardHeaders: true,
    legacyHeaders: false,
    store: require('../utils/redis').getRateLimitStore('admin-auth'),
    passOnStoreError: true,
    message: { success: false, message: 'Too many sign-in attempts. Please try again later.' },
});

function fail(res, status, message, code) {
    return res.status(status).json({ success: false, message, code });
}

function handle(req, res, error, fallback) {
    return adminHttp.fail(req, res, error, fallback);
}

async function issueAdminSession(user, req) {
    const sid = crypto.randomBytes(24).toString('hex');
    await AdminSession.create({
        sid,
        userId: user._id,
        ip: String(req.ip || '').slice(0, 64),
        userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
        expiresAt: new Date(Date.now() + ADMIN_SESSION_MAX_MS),
    });
    const token = jwt.sign(
        { userId: String(user._id), tokenVersion: normalizeTokenVersion(user.tokenVersion), scope: 'admin', sid },
        process.env.JWT_SECRET,
        { expiresIn: Math.floor(ADMIN_SESSION_MAX_MS / 1000) }
    );
    user.lastLogin = new Date();
    await user.save();
    req.admin = toAdminView(user);
    await recordAdminAction({ action: 'admin.login', target: String(user._id), details: { email: user.email }, req });
    return { token, admin: toAdminView(user), expiresInSeconds: ADMIN_SESSION_MAX_MS / 1000 };
}

/**
 * @swagger
 * /api/admin/auth/login:
 *   post:
 *     summary: Sign in to the admin panel
 *     tags: [Admin]
 */
router.post('/auth/login', adminAuthLimiter, async (req, res) => {
    try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!email || !password) return fail(res, 400, 'Please provide email and password', 'VALIDATION_ERROR');

        if (await isLockedOut(email)) {
            return fail(res, 429, 'Account locked due to too many failed attempts. Try again in 30 minutes.', 'ACCOUNT_LOCKED');
        }
        const user = await User.findOne({ email }).select('+twoFactor.totpSecret');
        const valid = Boolean(user && user.password) && await user.comparePassword(password);
        // Non-admins get the same answer as a wrong password: the admin
        // endpoint must not confirm which emails belong to staff.
        if (!valid || !isPlatformAdminRole(user.platformRole)) {
            if (user) await recordFailure(email);
            return fail(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        }
        if (user.isBanned) return fail(res, 403, 'This account has been suspended', 'ACCOUNT_SUSPENDED');
        await clearLockout(email);

        const settings = await getSettings();
        const needs2FA = settings.security.enforceAdmin2FA || Boolean(user.twoFactor?.totpEnabled);
        if (needs2FA) {
            const challenge = await twoFactor.createChallenge(user, {
                purpose: 'admin',
                allowedMethods: settings.security.twoFactorMethods,
            });
            return res.json({ success: true, data: { requires2FA: true, ...challenge } });
        }
        const session = await issueAdminSession(user, req);
        return res.json({ success: true, data: { requires2FA: false, ...session } });
    } catch (error) {
        return handle(req, res, error, 'Could not sign in');
    }
});

router.post('/auth/verify-2fa', adminAuthLimiter, async (req, res) => {
    try {
        const user = await twoFactor.verifyChallenge(req.body?.challengeToken, req.body?.code, 'admin');
        if (!isPlatformAdminRole(user.platformRole)) return fail(res, 401, 'Invalid email or password', 'INVALID_CREDENTIALS');
        const session = await issueAdminSession(user, req);
        return res.json({ success: true, data: session });
    } catch (error) {
        return handle(req, res, error, 'Could not verify the code');
    }
});

router.post('/auth/resend-2fa', adminAuthLimiter, async (req, res) => {
    try {
        const result = await twoFactor.resendChallenge(req.body?.challengeToken, 'admin');
        return res.json({ success: true, data: result });
    } catch (error) {
        return handle(req, res, error, 'Could not resend the code');
    }
});

router.post('/auth/logout', requirePlatformAdmin, async (req, res) => {
    try {
        await AdminSession.updateOne({ sid: req.adminSession.sid }, { $set: { revokedAt: new Date() } });
        await recordAdminAction({ action: 'admin.logout', target: req.admin.id, details: {}, req });
        return res.json({ success: true, message: 'Signed out' });
    } catch (error) {
        return sendInternalError(req, res, error, { message: 'Could not sign out' });
    }
});

router.get('/me', requirePlatformAdmin, async (req, res) => {
    try {
        const settings = await getSettings();
        return res.json({
            success: true,
            data: {
                admin: req.admin,
                session: {
                    idleTimeoutMinutes: settings.security.sessionTimeoutMinutes,
                    lastSeenAt: req.adminSession.lastSeenAt,
                },
                platform: { name: settings.general.platformName },
                twoFactor: {
                    enforced: settings.security.enforceAdmin2FA,
                    methods: settings.security.twoFactorMethods,
                    totpEnabled: req.admin.totpEnabled,
                },
            },
        });
    } catch (error) {
        return sendInternalError(req, res, error, { message: 'Could not load your account' });
    }
});

router.post('/me/email/request', requirePlatformAdmin, adminAuthLimiter, async (req, res) => {
    try {
        const newEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
        if (!EMAIL_RE.test(newEmail) || newEmail.length > 254) return fail(res, 400, 'Enter a valid email address', 'VALIDATION_ERROR');
        const user = await User.findById(req.admin.id);
        if (!user) return fail(res, 404, 'User not found', 'NOT_FOUND');
        if (newEmail === user.email) return fail(res, 400, 'That is already your email address', 'VALIDATION_ERROR');
        if (!user.password || !(await user.comparePassword(password))) {
            return fail(res, 401, 'Current password is incorrect', 'INVALID_CREDENTIALS');
        }
        if (await User.exists({ email: newEmail })) return fail(res, 409, 'That email address is already in use', 'EMAIL_IN_USE');

        const token = crypto.randomBytes(32).toString('hex');
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        await TwoFactorChallenge.create({
            tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
            userId: user._id,
            purpose: 'email_change',
            method: 'email',
            newEmail,
            codeHash: crypto.createHash('sha256').update(code).digest('hex'),
            lastSentAt: new Date(),
            expiresAt: new Date(Date.now() + twoFactor.CHALLENGE_TTL_MS),
        });
        const { sendSignInCodeEmail } = require('../utils/emailServiceResend');
        const sent = await sendSignInCodeEmail(newEmail, code, user.fullName || 'there', { context: 'BuildrsHQ email change' });
        if (sent?.success === false) return fail(res, 502, 'We could not send the verification code. Please try again.', 'EMAIL_DELIVERY_FAILED');
        return res.json({ success: true, data: { challengeToken: token, destination: twoFactor.maskEmail(newEmail) } });
    } catch (error) {
        return handle(req, res, error, 'Could not start the email change');
    }
});

router.post('/me/email/confirm', requirePlatformAdmin, adminAuthLimiter, async (req, res) => {
    try {
        const token = String(req.body?.challengeToken || '');
        const code = String(req.body?.code || '').trim();
        if (!/^[a-f0-9]{64}$/.test(token) || !/^\d{6}$/.test(code)) return fail(res, 400, 'Enter the 6-digit code', 'VALIDATION_ERROR');
        const challenge = await TwoFactorChallenge.findOneAndUpdate(
            {
                tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
                purpose: 'email_change',
                userId: req.admin.id,
                consumedAt: null,
                expiresAt: { $gt: new Date() },
                attempts: { $lt: twoFactor.MAX_ATTEMPTS },
            },
            { $inc: { attempts: 1 } },
            { new: true }
        );
        if (!challenge) return fail(res, 401, 'This code has expired. Request a new one.', 'CHALLENGE_INVALID');
        const expected = Buffer.from(challenge.codeHash);
        const actual = Buffer.from(crypto.createHash('sha256').update(code).digest('hex'));
        if (!crypto.timingSafeEqual(expected, actual)) return fail(res, 400, 'Incorrect code', 'INVALID_CODE');
        if (await User.exists({ email: challenge.newEmail, _id: { $ne: req.admin.id } })) {
            return fail(res, 409, 'That email address is already in use', 'EMAIL_IN_USE');
        }
        await TwoFactorChallenge.updateOne({ _id: challenge._id }, { $set: { consumedAt: new Date() } });
        const user = await User.findByIdAndUpdate(req.admin.id, { $set: { email: challenge.newEmail, isVerified: true } }, { new: true });
        await recordAdminAction({ action: 'admin.email_changed', target: req.admin.id, details: { from: req.admin.email, to: challenge.newEmail }, req });
        return res.json({ success: true, data: { admin: toAdminView(user) } });
    } catch (error) {
        if (error?.code === 11000) return fail(res, 409, 'That email address is already in use', 'EMAIL_IN_USE');
        return handle(req, res, error, 'Could not change your email');
    }
});

router.post('/me/2fa/totp/setup', requirePlatformAdmin, async (req, res) => {
    try {
        return res.json({ success: true, data: await twoFactor.beginTotpEnrollment(req.admin.id) });
    } catch (error) {
        return handle(req, res, error, 'Could not start authenticator setup');
    }
});

router.post('/me/2fa/totp/confirm', requirePlatformAdmin, adminAuthLimiter, async (req, res) => {
    try {
        const result = await twoFactor.confirmTotpEnrollment(req.admin.id, req.body?.code);
        await recordAdminAction({ action: 'admin.totp_enabled', target: req.admin.id, details: {}, req });
        return res.json({ success: true, data: result });
    } catch (error) {
        return handle(req, res, error, 'Could not enable the authenticator app');
    }
});

router.post('/me/2fa/totp/disable', requirePlatformAdmin, adminAuthLimiter, async (req, res) => {
    try {
        const result = await twoFactor.disableTotp(req.admin.id, req.body?.code);
        await recordAdminAction({ action: 'admin.totp_disabled', target: req.admin.id, details: {}, req });
        return res.json({ success: true, data: result });
    } catch (error) {
        return handle(req, res, error, 'Could not disable the authenticator app');
    }
});

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return sendError(req, res, error);
});

module.exports = router;
module.exports.ADMIN_SESSION_MAX_MS = ADMIN_SESSION_MAX_MS;
