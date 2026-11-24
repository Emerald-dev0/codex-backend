jest.mock('../utils/platformSettings', () => ({ getSettings: jest.fn() }));

const { getSettings } = require('../utils/platformSettings');
const { maintenanceMode, isAllowed } = require('../middleware/maintenanceMode');

function run(path, settings) {
  getSettings.mockResolvedValue(settings);
  const req = { originalUrl: path, path };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  const next = jest.fn();
  return maintenanceMode(req, res, next).then(() => ({ res, next }));
}

const on = { registration: { maintenanceMode: true }, general: { platformName: 'BuildrsHQ' } };
const off = { registration: { maintenanceMode: false }, general: { platformName: 'BuildrsHQ' } };

test('allowlist keeps admin, auth, support, health and webhooks reachable', () => {
  ['/api/admin/me', '/api/auth/signin', '/api/support/tickets', '/api/health', '/api/v1/billing/webhook/stripe', '/api/paystack-billing/webhook']
    .forEach((p) => expect(isAllowed(p)).toBe(true));
  ['/api/projects', '/api/administrator', '/api/companies'].forEach((p) => expect(isAllowed(p)).toBe(false));
});

test('blocks product APIs with 503 while maintenance mode is on', async () => {
  const { res, next } = await run('/api/projects?x=1', on);
  expect(next).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MAINTENANCE_MODE' }));
  expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '600');
});

test('passes through when off, and for allowlisted paths when on', async () => {
  expect((await run('/api/projects', off)).next).toHaveBeenCalled();
  expect((await run('/api/admin/settings', on)).next).toHaveBeenCalled();
});

test('fails open if settings cannot be read', async () => {
  getSettings.mockRejectedValue(new Error('db down'));
  const next = jest.fn();
  await maintenanceMode({ originalUrl: '/api/projects' }, {}, next);
  expect(next).toHaveBeenCalled();
});
