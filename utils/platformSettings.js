/**
 * Cached access to the PlatformSettings singleton plus validation for the
 * admin update endpoints. Readers on hot paths (maintenance middleware,
 * signup, password changes) get a value at most CACHE_TTL_MS old; writers
 * through `update*` refresh the local cache immediately.
 */
const mongoose = require('mongoose');

const CACHE_TTL_MS = parseInt(process.env.PLATFORM_SETTINGS_CACHE_MS, 10) || 15000;
const TWO_FACTOR_METHODS = ['sms', 'authenticator', 'email'];
// No SMS provider is integrated yet; flip when one is (e.g. Twilio env present).
const SMS_AVAILABLE = () => false;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DEFAULTS = Object.freeze({
    general: {
        platformName: 'BuildrsHQ',
        platformUrl: 'app.buildrshq.com',
        supportEmail: 'support@buildrshq.com',
        billingEmail: 'billing@buildrshq.com',
    },
    registration: {
        allowRegistrations: true,
        requireEmailVerification: true,
        allowBusinessAccounts: true,
        maintenanceMode: false,
    },
    security: {
        enforceAdmin2FA: false,
        requireUser2FA: false,
        twoFactorMethods: ['email'],
        minPasswordLength: 8,
        requireSpecialChars: false,
        requireNumbers: false,
        sessionTimeoutMinutes: 30,
    },
});

let cache = null;
let cacheExpires = 0;

function model() {
    return require('../models/PlatformSettings');
}

function plain(doc) {
    const src = doc && typeof doc.toObject === 'function' ? doc.toObject() : (doc || {});
    return {
        general: { ...DEFAULTS.general, ...(src.general || {}) },
        registration: { ...DEFAULTS.registration, ...(src.registration || {}) },
        security: {
            ...DEFAULTS.security,
            ...(src.security || {}),
            twoFactorMethods: Array.isArray(src.security?.twoFactorMethods)
                ? [...src.security.twoFactorMethods]
                : [...DEFAULTS.security.twoFactorMethods],
        },
        updatedAt: src.updatedAt || null,
    };
}

function defaults() {
    return plain(null);
}

async function getSettings({ fresh = false } = {}) {
    if (!fresh && cache && cacheExpires > Date.now()) return cache;
    if (mongoose.connection.readyState !== 1 && !fresh) {
        // No DB (tests, boot): behave as defaults rather than blocking traffic.
        return cache || defaults();
    }
    try {
        const doc = await model().findOne({ key: 'platform' }).lean();
        cache = plain(doc);
        cacheExpires = Date.now() + CACHE_TTL_MS;
        return cache;
    } catch (error) {
        console.error('[platform-settings] read failed:', error.message);
        return cache || defaults();
    }
}

/** Synchronous best-effort read for middleware that must not await. */
function getCachedSettings() {
    return cache || defaults();
}

function clearSettingsCache() {
    cache = null;
    cacheExpires = 0;
}

function badRequest(message) {
    const error = new Error(message);
    error.statusCode = 400;
    error.code = 'VALIDATION_ERROR';
    return error;
}

function asBool(value, field) {
    if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`);
    return value;
}

function asString(value, field, { max = 200, email = false, required = true } = {}) {
    if (value == null || value === '') {
        if (required) throw badRequest(`${field} is required`);
        return '';
    }
    if (typeof value !== 'string') throw badRequest(`${field} must be text`);
    const trimmed = value.trim();
    if (required && !trimmed) throw badRequest(`${field} is required`);
    if (trimmed.length > max) throw badRequest(`${field} must be ${max} characters or fewer`);
    if (email && !EMAIL_RE.test(trimmed)) throw badRequest(`${field} must be a valid email address`);
    return email ? trimmed.toLowerCase() : trimmed;
}

function asInt(value, field, min, max) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) {
        throw badRequest(`${field} must be a whole number between ${min} and ${max}`);
    }
    return n;
}

function validateGeneral(body = {}) {
    const general = body.general || {};
    const registration = body.registration || {};
    const out = {};
    if (body.general !== undefined) {
        out['general.platformName'] = asString(general.platformName, 'Platform name', { max: 80 });
        const url = asString(general.platformUrl, 'Platform URL', { max: 200 });
        if (!/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(url)) {
            throw badRequest('Platform URL must be a valid domain, e.g. app.buildrshq.com');
        }
        out['general.platformUrl'] = url;
        out['general.supportEmail'] = asString(general.supportEmail, 'Support email', { email: true });
        out['general.billingEmail'] = asString(general.billingEmail, 'Billing email', { email: true });
    }
    if (body.registration !== undefined) {
        for (const key of Object.keys(DEFAULTS.registration)) {
            if (registration[key] !== undefined) out[`registration.${key}`] = asBool(registration[key], key);
        }
    }
    if (body.security && body.security.enforceAdmin2FA !== undefined) {
        out['security.enforceAdmin2FA'] = asBool(body.security.enforceAdmin2FA, 'enforceAdmin2FA');
    }
    if (Object.keys(out).length === 0) throw badRequest('No settings to update');
    return out;
}

function validateSecurity(body = {}) {
    const s = body.security || body;
    const out = {};
    if (s.requireUser2FA !== undefined) out['security.requireUser2FA'] = asBool(s.requireUser2FA, 'requireUser2FA');
    if (s.enforceAdmin2FA !== undefined) out['security.enforceAdmin2FA'] = asBool(s.enforceAdmin2FA, 'enforceAdmin2FA');
    if (s.requireSpecialChars !== undefined) out['security.requireSpecialChars'] = asBool(s.requireSpecialChars, 'requireSpecialChars');
    if (s.requireNumbers !== undefined) out['security.requireNumbers'] = asBool(s.requireNumbers, 'requireNumbers');
    if (s.minPasswordLength !== undefined) out['security.minPasswordLength'] = asInt(s.minPasswordLength, 'Minimum password length', 8, 64);
    if (s.sessionTimeoutMinutes !== undefined) out['security.sessionTimeoutMinutes'] = asInt(s.sessionTimeoutMinutes, 'Session timeout', 5, 1440);
    if (s.twoFactorMethods !== undefined) {
        if (!Array.isArray(s.twoFactorMethods)) throw badRequest('twoFactorMethods must be a list');
        const methods = [...new Set(s.twoFactorMethods.map(String))];
        const invalid = methods.filter((m) => !TWO_FACTOR_METHODS.includes(m));
        if (invalid.length) throw badRequest(`Unsupported 2FA method: ${invalid.join(', ')}`);
        if (methods.includes('sms') && !SMS_AVAILABLE()) {
            throw badRequest('SMS verification is not available: no SMS provider is configured');
        }
        out['security.twoFactorMethods'] = methods;
    }
    const requires2FA = out['security.requireUser2FA'];
    if (requires2FA === true && out['security.twoFactorMethods'] && out['security.twoFactorMethods'].length === 0) {
        throw badRequest('Choose at least one 2FA method when 2FA is required');
    }
    if (Object.keys(out).length === 0) throw badRequest('No settings to update');
    return out;
}

async function applyUpdate(set, adminId) {
    const doc = await model().findOneAndUpdate(
        { key: 'platform' },
        { $set: { ...set, updatedBy: adminId || null }, $setOnInsert: { key: 'platform' } },
        { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
    ).lean();
    cache = plain(doc);
    cacheExpires = Date.now() + CACHE_TTL_MS;
    return cache;
}

async function updateGeneral(body, adminId) {
    return applyUpdate(validateGeneral(body), adminId);
}

async function updateSecurity(body, adminId) {
    return applyUpdate(validateSecurity(body), adminId);
}

module.exports = {
    SMS_AVAILABLE,
    DEFAULTS,
    TWO_FACTOR_METHODS,
    getSettings,
    getCachedSettings,
    clearSettingsCache,
    validateGeneral,
    validateSecurity,
    updateGeneral,
    updateSecurity,
    defaults,
};
