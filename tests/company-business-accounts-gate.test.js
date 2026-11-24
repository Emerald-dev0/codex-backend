/** Admin › Settings › "Allow business account creation" is enforced on company create. */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, res, next) => { req.userId = '507f1f77bcf86cd799439011'; req.user = { userId: req.userId }; next(); },
  normalizeTokenVersion: (v) => v || 0,
}));
jest.mock('../middleware/permissionMatrix', () => ({ requirePermission: () => (req, res, next) => next() }));
jest.mock('../utils/platformSettings', () => ({ getSettings: jest.fn() }));
jest.mock('../models/Subscription', () => ({ findOne: jest.fn(async () => null) }));
jest.mock('../models/User', () => ({ findById: jest.fn(async () => null) }));
jest.mock('../models/Company', () => ({ countDocuments: jest.fn(async () => 99) }));

const express = require('express');
const request = require('supertest');
const { getSettings } = require('../utils/platformSettings');
const Subscription = require('../models/Subscription');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/company', require('../routes/company'));
  return a;
}

beforeEach(() => { jest.clearAllMocks(); jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test('returns 403 BUSINESS_ACCOUNTS_DISABLED when the setting is off', async () => {
  getSettings.mockResolvedValue({ registration: { allowBusinessAccounts: false } });
  const res = await request(app()).post('/api/company/create').send({ name: 'Acme' });
  expect(res.status).toBe(403);
  expect(res.body.code).toBe('BUSINESS_ACCOUNTS_DISABLED');
  expect(Subscription.findOne).not.toHaveBeenCalled();
});

test('continues to the normal subscription checks when allowed', async () => {
  getSettings.mockResolvedValue({ registration: { allowBusinessAccounts: true } });
  const res = await request(app()).post('/api/company/create').send({ name: 'Acme' });
  expect(res.body.code).toBe('WORKSPACE_LIMIT_REACHED');
  expect(Subscription.findOne).toHaveBeenCalled();
});
