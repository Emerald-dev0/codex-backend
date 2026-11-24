/**
 * Platform password policy (Admin › Settings › Security). The 8-character
 * floor matches the long-standing change-password rule and can only be
 * raised by an admin, never lowered.
 */
const { getSettings } = require('./platformSettings');

const HARD_MINIMUM = 8;
const SPECIAL_RE = /[^A-Za-z0-9\s]/;
const NUMBER_RE = /\d/;

function checkPassword(password, policy = {}) {
    const min = Math.max(HARD_MINIMUM, Number(policy.minPasswordLength) || HARD_MINIMUM);
    if (typeof password !== 'string' || password.length < min) {
        return { ok: false, message: `Password must be at least ${min} characters long` };
    }
    if (policy.requireNumbers && !NUMBER_RE.test(password)) {
        return { ok: false, message: 'Password must contain at least one number' };
    }
    if (policy.requireSpecialChars && !SPECIAL_RE.test(password)) {
        return { ok: false, message: 'Password must contain at least one special character (e.g. !"£$%&)' };
    }
    return { ok: true };
}

async function validatePassword(password) {
    const settings = await getSettings();
    return checkPassword(password, settings.security);
}

module.exports = { HARD_MINIMUM, checkPassword, validatePassword };
