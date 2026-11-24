/**
 * Two-factor authentication for sign-in (admin panel and, when required by
 * Admin › Settings › Security, end users).
 *
 * Methods:
 *  - authenticator: RFC 6238 TOTP (SHA-1, 6 digits, 30s) using node:crypto.
 *  - email: 6-digit one-time code delivered by email.
 * SMS is not offered: no SMS provider is configured on the platform.
 */
const crypto = require('crypto');
const User = require('../models/User');
const TwoFactorChallenge = require('../models/TwoFactorChallenge');
const { encryptSecret, decryptSecret } = require('./secretCrypto');

const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_RESENDS = 3;
const RESEND_COOLDOWN_MS = 30 * 1000;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function httpError(message, statusCode = 400, code = 'REQUEST_ERROR') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function base32Encode(buf) {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buf) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
    return out;
}

function base32Decode(str) {
    const clean = String(str || '').toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
    let bits = 0;
    let value = 0;
    const out = [];
    for (const ch of clean) {
        const idx = BASE32.indexOf(ch);
        if (idx === -1) throw new Error('Invalid base32 secret');
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            out.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }
    return Buffer.from(out);
}

function generateTotpSecret() {
    return base32Encode(crypto.randomBytes(20));
}

function totpCode(secret, counter) {
    const key = base32Decode(secret);
    const msg = Buffer.alloc(8);
    msg.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', key).update(msg).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(bin % 1000000).padStart(6, '0');
}

function verifyTotp(secret, token, { window = 1, now = Date.now() } = {}) {
    const code = String(token || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(code)) return false;
    const counter = Math.floor(now / 30000);
    for (let i = -window; i <= window; i += 1) {
        const expected = totpCode(secret, counter + i);
        if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return true;
    }
    return false;
}

function otpauthUri(secret, accountName, issuer = 'BuildrsHQ') {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function maskEmail(email) {
    const [local, domain] = String(email || '').split('@');
    if (!domain) return '';
    const head = local.slice(0, 2);
    return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function emailCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendEmailCode(user, code, purpose) {
    const { sendSignInCodeEmail } = require('./emailServiceResend');
    const result = await sendSignInCodeEmail(user.email, code, user.fullName || 'there', {
        context: purpose === 'admin' ? 'BuildrsHQ Admin' : 'BuildrsHQ',
    });
    if (result?.success === false) throw httpError('We could not send your sign-in code. Please try again.', 502, 'EMAIL_DELIVERY_FAILED');
}

/**
 * Pick the strongest available method the platform allows for this user.
 * Admin sign-in always allows email when 2FA is enforced.
 */
function chooseMethod(user, allowedMethods, purpose) {
    const allowed = new Set(allowedMethods || []);
    if (purpose === 'admin') allowed.add('email');
    if (allowed.has('authenticator') && user.twoFactor?.totpEnabled) return 'authenticator';
    if (allowed.has('email')) return 'email';
    return null;
}

async function createChallenge(user, { purpose, allowedMethods }) {
    const method = chooseMethod(user, allowedMethods, purpose);
    if (!method) throw httpError('No two-factor method is available for this account. Contact support.', 409, 'NO_2FA_METHOD');
    const token = crypto.randomBytes(32).toString('hex');
    const doc = {
        tokenHash: sha256(token),
        userId: user._id,
        purpose,
        method,
        expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    };
    let code = null;
    if (method === 'email') {
        code = emailCode();
        doc.codeHash = sha256(code);
        doc.lastSentAt = new Date();
    }
    await TwoFactorChallenge.create(doc);
    if (code) await sendEmailCode(user, code, purpose);
    return {
        challengeToken: token,
        method,
        destination: method === 'email' ? maskEmail(user.email) : 'your authenticator app',
        expiresInSeconds: CHALLENGE_TTL_MS / 1000,
    };
}

async function loadChallenge(token, purpose) {
    if (!/^[a-f0-9]{64}$/.test(String(token || ''))) throw httpError('This sign-in attempt has expired. Please sign in again.', 401, 'CHALLENGE_INVALID');
    const challenge = await TwoFactorChallenge.findOne({ tokenHash: sha256(token), purpose });
    if (!challenge || challenge.consumedAt || challenge.expiresAt < new Date() || challenge.attempts >= MAX_ATTEMPTS) {
        throw httpError('This sign-in attempt has expired. Please sign in again.', 401, 'CHALLENGE_INVALID');
    }
    return challenge;
}

/** Verify a code; returns the user document on success. */
async function verifyChallenge(token, code, purpose) {
    const challenge = await loadChallenge(token, purpose);
    const clean = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) throw httpError('Enter the 6-digit code', 400, 'VALIDATION_ERROR');

    // Count the attempt atomically before checking, so parallel guesses cannot exceed the cap.
    const counted = await TwoFactorChallenge.findOneAndUpdate(
        { _id: challenge._id, attempts: { $lt: MAX_ATTEMPTS }, consumedAt: null },
        { $inc: { attempts: 1 } },
        { new: true }
    );
    if (!counted) throw httpError('Too many incorrect codes. Please sign in again.', 401, 'CHALLENGE_INVALID');

    let ok = false;
    if (challenge.method === 'email') {
        ok = Boolean(challenge.codeHash) && crypto.timingSafeEqual(Buffer.from(challenge.codeHash), Buffer.from(sha256(clean)));
    } else {
        const user = await User.findById(challenge.userId).select('+twoFactor.totpSecret twoFactor.totpEnabled');
        const secret = user?.twoFactor?.totpEnabled ? decryptSecret(user.twoFactor.totpSecret) : null;
        ok = Boolean(secret) && verifyTotp(secret, clean);
    }
    if (!ok) {
        const left = MAX_ATTEMPTS - counted.attempts;
        throw httpError(left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.` : 'Too many incorrect codes. Please sign in again.', 401, left > 0 ? 'INVALID_CODE' : 'CHALLENGE_INVALID');
    }
    const consumed = await TwoFactorChallenge.findOneAndUpdate(
        { _id: challenge._id, consumedAt: null },
        { $set: { consumedAt: new Date() } }
    );
    if (!consumed) throw httpError('This sign-in attempt has expired. Please sign in again.', 401, 'CHALLENGE_INVALID');
    const user = await User.findById(challenge.userId);
    if (!user || user.isBanned) throw httpError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
    return user;
}

async function resendChallenge(token, purpose) {
    const challenge = await loadChallenge(token, purpose);
    if (challenge.method !== 'email') throw httpError('Open your authenticator app to get a new code', 400, 'NOT_RESENDABLE');
    if (challenge.resends >= MAX_RESENDS) throw httpError('Too many codes requested. Please sign in again.', 429, 'TOO_MANY_RESENDS');
    if (challenge.lastSentAt && Date.now() - challenge.lastSentAt.getTime() < RESEND_COOLDOWN_MS) {
        throw httpError('Please wait a few seconds before requesting another code', 429, 'RESEND_COOLDOWN');
    }
    const user = await User.findById(challenge.userId).select('email fullName');
    if (!user) throw httpError('This sign-in attempt has expired. Please sign in again.', 401, 'CHALLENGE_INVALID');
    const code = emailCode();
    challenge.codeHash = sha256(code);
    challenge.resends += 1;
    challenge.attempts = 0;
    challenge.lastSentAt = new Date();
    await challenge.save();
    await sendEmailCode(user, code, purpose);
    return { method: 'email', destination: maskEmail(user.email) };
}

/** Begin authenticator enrolment: store an encrypted pending secret. */
async function beginTotpEnrollment(userId) {
    const user = await User.findById(userId).select('email twoFactor.totpEnabled');
    if (!user) throw httpError('User not found', 404, 'NOT_FOUND');
    const secret = generateTotpSecret();
    await User.updateOne({ _id: userId }, { $set: { 'twoFactor.totpPendingSecret': encryptSecret(secret) } });
    return { secret, otpauthUri: otpauthUri(secret, user.email) };
}

async function confirmTotpEnrollment(userId, code) {
    const user = await User.findById(userId).select('+twoFactor.totpPendingSecret');
    const pending = user?.twoFactor?.totpPendingSecret ? decryptSecret(user.twoFactor.totpPendingSecret) : null;
    if (!pending) throw httpError('Start authenticator setup first', 400, 'NO_PENDING_ENROLLMENT');
    if (!verifyTotp(pending, code)) throw httpError('That code is not valid. Check the time on your device and try again.', 400, 'INVALID_CODE');
    await User.updateOne({ _id: userId }, {
        $set: { 'twoFactor.totpEnabled': true, 'twoFactor.totpSecret': encryptSecret(pending), 'twoFactor.totpEnabledAt': new Date() },
        $unset: { 'twoFactor.totpPendingSecret': 1 },
    });
    return { totpEnabled: true };
}

async function disableTotp(userId, code) {
    const user = await User.findById(userId).select('+twoFactor.totpSecret twoFactor.totpEnabled');
    if (!user?.twoFactor?.totpEnabled) return { totpEnabled: false };
    const secret = decryptSecret(user.twoFactor.totpSecret);
    if (!verifyTotp(secret, code)) throw httpError('That code is not valid', 400, 'INVALID_CODE');
    await User.updateOne({ _id: userId }, {
        $set: { 'twoFactor.totpEnabled': false },
        $unset: { 'twoFactor.totpSecret': 1, 'twoFactor.totpPendingSecret': 1, 'twoFactor.totpEnabledAt': 1 },
    });
    return { totpEnabled: false };
}

module.exports = {
    CHALLENGE_TTL_MS,
    MAX_ATTEMPTS,
    base32Encode,
    base32Decode,
    generateTotpSecret,
    totpCode,
    verifyTotp,
    otpauthUri,
    maskEmail,
    chooseMethod,
    createChallenge,
    verifyChallenge,
    resendChallenge,
    beginTotpEnrollment,
    confirmTotpEnrollment,
    disableTotp,
};
