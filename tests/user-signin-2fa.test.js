/** Admin › Settings › Security: user sign-in second factor. */
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-user-signin-2fa-32chars';

jest.mock('../models/User', () => ({ db: { readyState: 1 }, exists: jest.fn(), findById: jest.fn(), findOne: jest.fn() }));
jest.mock('../models/AuthLockout', () => ({
  isLockedOut: jest.fn(async () => false),
  recordFailure: jest.fn(async () => {}),
  clearLockout: jest.fn(async () => {}),
}));
jest.mock('../middleware/trial', () => ({
  getOrCreateSubscription: jest.fn(async () => ({ tier: 'pro', status: 'active', trialEndsAt: null, getTrialDaysLeft: () => 0 })),
  createTrialSubscription: jest.fn(),
}));
jest.mock('../utils/emailServiceResend', () => ({
  sendOTPEmail: jest.fn(async () => ({ success: true })),
  sendWelcomeEmail: jest.fn(async () => {}),
  sendTrialWelcomeEmail: jest.fn(async () => {}),
  sendSignInCodeEmail: jest.fn(async () => ({ success: true })),
}));
const mockSettings = { registration: { requireEmailVerification: true }, security: { requireUser2FA: false, twoFactorMethods: ['email'] } };
jest.mock('../utils/platformSettings', () => ({
  getSettings: jest.fn(async () => mockSettings),
  DEFAULTS: {},
}));
jest.mock('../utils/twoFactor', () => ({
  createChallenge: jest.fn(async () => ({ challengeToken: 'c'.repeat(64), method: 'email', destination: 'us••@example.com', expiresInSeconds: 600 })),
  verifyChallenge: jest.fn(),
  resendChallenge: jest.fn(async () => ({ destination: 'us••@example.com', expiresInSeconds: 600 })),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const twoFactor = require('../utils/twoFactor');

const app = express();
app.use(express.json());
app.use('/api/auth', require('../routes/auth'));

const USER_ID = '507f1f77bcf86cd799439011';
let userDoc;

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.security.requireUser2FA = false;
  userDoc = {
    _id: USER_ID, email: 'user@example.com', fullName: 'Test User', authProvider: 'local', isVerified: true,
    tokenVersion: 2, password: 'hashed', twoFactor: {},
    comparePassword: jest.fn(async (p) => p === 'right-password'),
    save: jest.fn(async function save() { return this; }),
  };
  User.findOne.mockImplementation(async () => userDoc);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test('no second factor when not required and not enrolled', async () => {
  const res = await request(app).post('/api/auth/signin').send({ email: 'user@example.com', password: 'right-password' });
  expect(res.status).toBe(200);
  expect(res.body.token).toBeTruthy();
  expect(twoFactor.createChallenge).not.toHaveBeenCalled();
});

test('requireUser2FA returns a challenge instead of a token', async () => {
  mockSettings.security.requireUser2FA = true;
  const res = await request(app).post('/api/auth/signin').send({ email: 'user@example.com', password: 'right-password' });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ requires2FA: true, method: 'email' });
  expect(res.body.token).toBeUndefined();
  expect(twoFactor.createChallenge).toHaveBeenCalledWith(userDoc, { purpose: 'user', allowedMethods: ['email'] });
});

test('an enrolled authenticator is always challenged', async () => {
  userDoc.twoFactor = { totpEnabled: true };
  const res = await request(app).post('/api/auth/signin').send({ email: 'user@example.com', password: 'right-password' });
  expect(res.body.requires2FA).toBe(true);
});

test('wrong password never reaches the challenge', async () => {
  mockSettings.security.requireUser2FA = true;
  const res = await request(app).post('/api/auth/signin').send({ email: 'user@example.com', password: 'nope' });
  expect(res.status).toBe(401);
  expect(twoFactor.createChallenge).not.toHaveBeenCalled();
});

test('verify-2fa issues the normal session token', async () => {
  twoFactor.verifyChallenge.mockResolvedValue(userDoc);
  const res = await request(app).post('/api/auth/signin/verify-2fa').send({ challengeToken: 'c'.repeat(64), code: '123456' });
  expect(res.status).toBe(200);
  expect(twoFactor.verifyChallenge).toHaveBeenCalledWith('c'.repeat(64), '123456', 'user');
  expect(jwt.verify(res.body.token, process.env.JWT_SECRET)).toMatchObject({ userId: USER_ID, tokenVersion: 2 });
  expect(res.body.token).toBeTruthy();
});

test('verify-2fa surfaces challenge errors with their status', async () => {
  twoFactor.verifyChallenge.mockRejectedValue(Object.assign(new Error('Invalid code'), { statusCode: 400, code: 'INVALID_CODE' }));
  const res = await request(app).post('/api/auth/signin/verify-2fa').send({ challengeToken: 'c'.repeat(64), code: '000000' });
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ success: false, code: 'INVALID_CODE' });
});
