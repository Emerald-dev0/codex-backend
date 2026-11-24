/** Finance › Withdraw: validation, idempotency, and request-only default. */
jest.mock('../models/Withdrawal', () => ({ findOne: jest.fn(), create: jest.fn() }));
jest.mock('../models/Counter', () => ({ nextSequence: jest.fn(async () => 1001) }));
jest.mock('../utils/adminNotifications', () => ({ notifyAdmins: jest.fn(async () => null) }));
jest.mock('../utils/admin/providerOps', () => ({
  GATEWAYS: { stripe: { name: 'Stripe' }, paypal: { name: 'PayPal' } },
  getGateways: jest.fn(),
  createPayout: jest.fn(async () => ({ providerTransferId: 'po_1', status: 'processing' })),
  clearBalanceCache: jest.fn(),
}));

const Withdrawal = require('../models/Withdrawal');
const providerOps = require('../utils/admin/providerOps');
const { notifyAdmins } = require('../utils/adminNotifications');
const counter = require('../models/Counter');
const finance = require('../utils/admin/financeService');

const ADMIN = { id: '507f1f77bcf86cd799439011', fullName: 'Daniel Uche' };
const body = (over = {}) => ({ provider: 'stripe', amountMinor: 5000, currency: 'USD', idempotencyKey: 'abcdef1234567890', ...over });
const stripeGateway = { id: 'stripe', name: 'Stripe', configured: true, supported: true, payout: { configured: true, label: 'Chase ••4821' }, balances: [{ currency: 'USD', availableMinor: 10000 }] };

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ADMIN_PAYOUTS_ENABLED;
  Withdrawal.findOne.mockReturnValue({ lean: async () => null });
  Withdrawal.create.mockImplementation(async (doc) => ({ ...doc, createdAt: new Date(), save: jest.fn(async () => {}), toObject() { return { ...this }; } }));
  providerOps.getGateways.mockResolvedValue([stripeGateway, { id: 'paypal', name: 'PayPal', configured: false, supported: false, payout: { configured: false }, balances: [] }]);
  counter.nextSequence.mockResolvedValue(1001);
});

test.each([
  [{ provider: 'bank' }, 'destination'],
  [{ amountMinor: 0 }, 'greater than zero'],
  [{ amountMinor: 12.5 }, 'greater than zero'],
  [{ currency: 'dollars' }, 'currency'],
  [{ idempotencyKey: 'x' }, 'idempotency'],
])('validates %j', async (over, msg) => {
  await expect(finance.createWithdrawal(body(over), ADMIN)).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(new RegExp(msg, 'i')) });
  expect(Withdrawal.create).not.toHaveBeenCalled();
});

test('replays an existing idempotency key without a new withdrawal', async () => {
  Withdrawal.findOne.mockReturnValue({ lean: async () => ({ reference: 'WD-1000', provider: 'stripe', amountMinor: 5000, currency: 'USD', status: 'requested' }) });
  const result = await finance.createWithdrawal(body(), ADMIN);
  expect(result.replayed).toBe(true);
  expect(Withdrawal.create).not.toHaveBeenCalled();
});

test('refuses unconnected gateways and amounts above the balance', async () => {
  await expect(finance.createWithdrawal(body({ provider: 'paypal' }), ADMIN)).rejects.toMatchObject({ statusCode: 409, code: 'PROVIDER_NOT_CONFIGURED' });
  await expect(finance.createWithdrawal(body({ amountMinor: 10001 }), ADMIN)).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
});

test('by default records a request and never calls the provider', async () => {
  const { withdrawal } = await finance.createWithdrawal(body(), ADMIN);
  expect(Withdrawal.create).toHaveBeenCalledWith(expect.objectContaining({ status: 'requested', reference: 'WD-1001', requestedBy: ADMIN.id }));
  expect(providerOps.createPayout).not.toHaveBeenCalled();
  expect(withdrawal.status).toBe('requested');
  expect(notifyAdmins).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('requested') }));
});

test('ADMIN_PAYOUTS_ENABLED=true executes the provider payout', async () => {
  process.env.ADMIN_PAYOUTS_ENABLED = 'true';
  await finance.createWithdrawal(body(), ADMIN);
  expect(providerOps.createPayout).toHaveBeenCalledWith({ provider: 'stripe', amountMinor: 5000, currency: 'USD', reference: 'WD-1001' });
});
