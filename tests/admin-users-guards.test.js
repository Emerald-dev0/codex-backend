/** Admin › Users: suspend / reinstate / sign-out guards (self, super admin, validation). */
jest.mock('../models/User', () => ({
  findById: jest.fn(),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
}));
jest.mock('../routes/admin', () => ({ setBanned: jest.fn(async () => {}) }));

const User = require('../models/User');
const { setBanned } = require('../routes/admin');
const users = require('../utils/admin/usersService');

const ADMIN = { id: '507f1f77bcf86cd799439011', platformRole: 'admin' };
const SUPER = { id: '507f1f77bcf86cd799439099', platformRole: 'super_admin' };
const TARGET = '507f1f77bcf86cd799439012';

function returns(doc) {
  const chain = { select: () => chain, lean: () => chain, then: (res, rej) => Promise.resolve(doc).then(res, rej) };
  User.findById.mockReturnValue(chain);
}

beforeEach(() => jest.clearAllMocks());

test('rejects malformed ids before touching the database', async () => {
  await expect(users.suspendUser('not-an-id', { reason: 'x' }, ADMIN)).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_ID' });
  expect(User.findById).not.toHaveBeenCalled();
});

test('a suspension reason is required', async () => {
  await expect(users.suspendUser(TARGET, { reason: '   ' }, ADMIN)).rejects.toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
  expect(setBanned).not.toHaveBeenCalled();
});

test('admins cannot suspend or sign out themselves', async () => {
  returns({ _id: ADMIN.id, platformRole: 'admin' });
  await expect(users.suspendUser(ADMIN.id, { reason: 'test' }, ADMIN)).rejects.toMatchObject({ code: 'SELF_ACTION' });
  await expect(users.signOutEverywhere(ADMIN.id, ADMIN)).rejects.toMatchObject({ code: 'SELF_ACTION' });
  expect(setBanned).not.toHaveBeenCalled();
  expect(User.updateOne).not.toHaveBeenCalled();
});

test('only a super admin can act on another super admin', async () => {
  returns({ _id: TARGET, platformRole: 'super_admin' });
  await expect(users.suspendUser(TARGET, { reason: 'abuse' }, ADMIN)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  await expect(users.reinstateUser(TARGET, ADMIN)).rejects.toMatchObject({ statusCode: 403 });
  expect(setBanned).not.toHaveBeenCalled();
});

test('missing users are 404', async () => {
  returns(null);
  await expect(users.suspendUser(TARGET, { reason: 'abuse' }, SUPER)).rejects.toMatchObject({ statusCode: 404 });
});

test('suspension goes through the shared setBanned (ban + token revocation)', async () => {
  returns({ _id: TARGET, platformRole: undefined });
  const getUser = jest.spyOn(users, 'getUser');
  // getUser re-reads the user afterwards; stop there.
  User.findById.mockReturnValueOnce({ select: () => ({ lean: async () => ({ _id: TARGET }) }) })
    .mockImplementationOnce(() => { throw Object.assign(new Error('stop'), { stop: true }); });
  await users.suspendUser(TARGET, { reason: '  chargeback fraud ' }, ADMIN).catch((e) => { if (!e.stop) throw e; });
  expect(setBanned).toHaveBeenCalledWith(TARGET, true, 'chargeback fraud');
  getUser.mockRestore();
});

test('sign out everywhere bumps tokenVersion', async () => {
  returns({ _id: TARGET, platformRole: undefined, tokenVersion: 3 });
  User.findById.mockReturnValueOnce({ select: async () => ({ _id: TARGET, tokenVersion: 3 }) })
    .mockImplementationOnce(() => { throw Object.assign(new Error('stop'), { stop: true }); });
  await users.signOutEverywhere(TARGET, ADMIN).catch((e) => { if (!e.stop) throw e; });
  expect(User.updateOne).toHaveBeenCalledWith({ _id: TARGET }, { $set: { tokenVersion: 4 } });
});
