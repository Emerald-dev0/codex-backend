/**
 * Admin panel authorization: admin-scoped session + DB role + super_admin
 * gates on money actions, and the admin login flow.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-admin-panel';

jest.mock('../utils/redis', () => ({ getRateLimitStore: () => undefined }));
jest.mock('../middleware/auth', () => ({
  normalizeTokenVersion: (v) => (Number(v) > 0 ? Math.floor(Number(v)) : 0),
  authenticateToken: (req, res, next) => {
    const raw = req.headers['x-test-user'];
    if (!raw) return res.status(401).json({ success: false, message: 'Access token required' });
    const payload = JSON.parse(raw);
    req.userId = payload.userId;
    req.user = payload;
    return next();
  },
}));

const mockSessions = new Map();
jest.mock('../models/AdminSession', () => ({
  findOne: jest.fn(({ sid }) => ({ lean: async () => mockSessions.get(sid) || null })),
  updateOne: jest.fn(async ({ _id, sid }, update) => {
    const s = [...mockSessions.values()].find((x) => x._id === _id || x.sid === sid);
    if (s && update.$set) Object.assign(s, update.$set);
    return { modifiedCount: s ? 1 : 0 };
  }),
  create: jest.fn(async (doc) => { mockSessions.set(doc.sid, { _id: doc.sid, ...doc, lastSeenAt: new Date(), createdAt: new Date() }); return doc; }),
}));

const mockUsers = new Map();
jest.mock('../models/User', () => ({
  findById: jest.fn((id) => {
    const chain = { select: () => chain, lean: () => chain, then: (res, rej) => Promise.resolve(mockUsers.get(String(id)) || null).then(res, rej) };
    return chain;
  }),
  findOne: jest.fn(({ email }) => {
    const found = [...mockUsers.values()].find((u) => u.email === email) || null;
    const chain = { select: () => chain, then: (res, rej) => Promise.resolve(found).then(res, rej) };
    return chain;
  }),
}));

jest.mock('../models/AuthLockout', () => ({
  isLockedOut: jest.fn(async () => false),
  recordFailure: jest.fn(async () => {}),
  clearLockout: jest.fn(async () => {}),
}));
jest.mock('../models/TwoFactorChallenge', () => ({}));

const mockSettings = { security: { sessionTimeoutMinutes: 30, enforceAdmin2FA: false, twoFactorMethods: ['email'] }, general: { platformName: 'BuildrsHQ' } };
jest.mock('../utils/platformSettings', () => ({ getSettings: jest.fn(async () => mockSettings) }));
jest.mock('../utils/adminAudit', () => ({ recordAdminAction: jest.fn(async () => null) }));
jest.mock('../utils/twoFactor', () => ({
  CHALLENGE_TTL_MS: 600000,
  MAX_ATTEMPTS: 5,
  createChallenge: jest.fn(async () => ({ challengeToken: 'a'.repeat(64), method: 'email', destination: 'ad••••@x.com', expiresInSeconds: 600 })),
  verifyChallenge: jest.fn(),
  resendChallenge: jest.fn(),
  maskEmail: (e) => e,
}));
jest.mock('../utils/admin/financeService', () => ({
  getSummary: jest.fn(async () => ({ mrr: { amountMinor: 100 } })),
  refundTransaction: jest.fn(async () => ({ payment: { reference: 'TXN-10001', currency: 'USD' }, refund: { amountMinor: 500, status: 'processed' } })),
  getTransaction: jest.fn(async () => ({ id: 'tx1', status: 'partially_refunded' })),
}));

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');
const AdminSession = require('../models/AdminSession');
const finance = require('../utils/admin/financeService');
const twoFactor = require('../utils/twoFactor');
const { recordAdminAction } = require('../utils/adminAudit');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/admin', require('../routes/admin-auth'));
  a.use('/api/admin/finance', requirePlatformAdmin, require('../routes/admin-finance'));
  return a;
}

const ADMIN_ID = '507f1f77bcf86cd799439011';
function asUser(payload) { return { 'x-test-user': JSON.stringify(payload) }; }
function adminToken(sid = 'sid-1', userId = ADMIN_ID) { return asUser({ userId, scope: 'admin', sid, tokenVersion: 0 }); }

beforeEach(() => {
  mockSessions.clear();
  mockUsers.clear();
  jest.clearAllMocks();
  mockSettings.security.enforceAdmin2FA = false;
  mockUsers.set(ADMIN_ID, {
    _id: ADMIN_ID, fullName: 'Daniel Uche', email: 'daniel@buildrshq.com', platformRole: 'admin', isBanned: false,
    password: 'hash', tokenVersion: 0, twoFactor: {},
    comparePassword: async (p) => p === 'correct-horse', save: jest.fn(async () => {}),
  });
  mockSessions.set('sid-1', { _id: 'sid-1', sid: 'sid-1', userId: ADMIN_ID, revokedAt: null, lastSeenAt: new Date(), createdAt: new Date(), expiresAt: new Date(Date.now() + 3600e3) });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('requirePlatformAdmin', () => {
  test('rejects a regular user-app token (no admin scope)', async () => {
    const res = await request(app()).get('/api/admin/finance/summary').set(asUser({ userId: ADMIN_ID, tokenVersion: 0 }));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ADMIN_SESSION_EXPIRED');
    expect(finance.getSummary).not.toHaveBeenCalled();
  });

  test('rejects an admin token whose session was revoked (logout)', async () => {
    mockSessions.get('sid-1').revokedAt = new Date();
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(res.status).toBe(401);
  });

  test('rejects a session bound to another user', async () => {
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken('sid-1', '507f1f77bcf86cd7994390ff'));
    expect(res.status).toBe(401);
  });

  test('enforces the idle timeout from settings and revokes the session', async () => {
    mockSessions.get('sid-1').lastSeenAt = new Date(Date.now() - 31 * 60 * 1000);
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/inactivity/);
    expect(mockSessions.get('sid-1').revokedAt).toBeInstanceOf(Date);
  });

  test('re-reads the role from the database: demoted users lose access immediately', async () => {
    mockUsers.get(ADMIN_ID).platformRole = undefined;
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('NOT_PLATFORM_ADMIN');
  });

  test('suspended admins are refused', async () => {
    mockUsers.get(ADMIN_ID).isBanned = true;
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(res.status).toBe(403);
  });

  test('a live admin session can read', async () => {
    const res = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { mrr: { amountMinor: 100 } } });
  });
});

describe('money actions require super_admin', () => {
  test('admin role cannot refund', async () => {
    const res = await request(app()).post('/api/admin/finance/transactions/tx1/refund').set(adminToken()).send({ reason: 'dup' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INSUFFICIENT_ADMIN_ROLE');
    expect(finance.refundTransaction).not.toHaveBeenCalled();
  });

  test('super_admin can refund and the action is audited', async () => {
    mockUsers.get(ADMIN_ID).platformRole = 'super_admin';
    const res = await request(app()).post('/api/admin/finance/transactions/tx1/refund').set(adminToken()).send({ amountMinor: 500, reason: 'duplicate charge' });
    expect(res.status).toBe(200);
    expect(finance.refundTransaction).toHaveBeenCalledWith('tx1', { amountMinor: 500, reason: 'duplicate charge' }, expect.objectContaining({ id: ADMIN_ID }));
    expect(recordAdminAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'payment.refund', target: 'tx1' }));
  });
});

describe('POST /api/admin/auth/login', () => {
  test('non-admin accounts get the same answer as a wrong password', async () => {
    mockUsers.get(ADMIN_ID).platformRole = undefined;
    const ok = await request(app()).post('/api/admin/auth/login').send({ email: 'daniel@buildrshq.com', password: 'correct-horse' });
    const bad = await request(app()).post('/api/admin/auth/login').send({ email: 'daniel@buildrshq.com', password: 'nope' });
    expect(ok.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(ok.body.message).toBe(bad.body.message);
    expect(AdminSession.create).not.toHaveBeenCalled();
  });

  test('issues an admin-scoped token bound to a new server session', async () => {
    const res = await request(app()).post('/api/admin/auth/login').send({ email: 'DANIEL@buildrshq.com', password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(res.body.data.requires2FA).toBe(false);
    const decoded = jwt.verify(res.body.data.token, process.env.JWT_SECRET);
    expect(decoded).toMatchObject({ userId: ADMIN_ID, scope: 'admin' });
    expect(mockSessions.get(decoded.sid)).toBeTruthy();
    expect(res.body.data.admin).toMatchObject({ email: 'daniel@buildrshq.com', role: 'admin' });
  });

  test('requires a second factor when admin 2FA is enforced', async () => {
    mockSettings.security.enforceAdmin2FA = true;
    const res = await request(app()).post('/api/admin/auth/login').send({ email: 'daniel@buildrshq.com', password: 'correct-horse' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ requires2FA: true, method: 'email' });
    expect(res.body.data.token).toBeUndefined();
    expect(twoFactor.createChallenge).toHaveBeenCalledWith(expect.objectContaining({ _id: ADMIN_ID }), expect.objectContaining({ purpose: 'admin' }));
  });

  test('logout revokes the server session', async () => {
    const res = await request(app()).post('/api/admin/auth/logout').set(adminToken());
    expect(res.status).toBe(200);
    expect(mockSessions.get('sid-1').revokedAt).toBeInstanceOf(Date);
    const after = await request(app()).get('/api/admin/finance/summary').set(adminToken());
    expect(after.status).toBe(401);
  });
});
