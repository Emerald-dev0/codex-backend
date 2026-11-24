const twoFactor = require('../utils/twoFactor');

// RFC 6238 Appendix B secret ("12345678901234567890") in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP (RFC 6238, SHA-1, 6 digits)', () => {
  test.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('time %i -> %s', (seconds, expected) => {
    expect(twoFactor.totpCode(RFC_SECRET, Math.floor(seconds / 30))).toBe(expected);
    expect(twoFactor.verifyTotp(RFC_SECRET, expected, { now: seconds * 1000, window: 0 })).toBe(true);
  });

  test('accepts one step of clock drift but not two', () => {
    const now = 1111111111 * 1000;
    const prev = twoFactor.totpCode(RFC_SECRET, Math.floor(now / 30000) - 1);
    const old = twoFactor.totpCode(RFC_SECRET, Math.floor(now / 30000) - 2);
    expect(twoFactor.verifyTotp(RFC_SECRET, prev, { now })).toBe(true);
    expect(twoFactor.verifyTotp(RFC_SECRET, old, { now })).toBe(false);
  });

  test('rejects malformed codes', () => {
    expect(twoFactor.verifyTotp(RFC_SECRET, '12345')).toBe(false);
    expect(twoFactor.verifyTotp(RFC_SECRET, 'abcdef')).toBe(false);
    expect(twoFactor.verifyTotp(RFC_SECRET, '')).toBe(false);
  });

  test('base32 round-trips and generated secrets are 160-bit', () => {
    const buf = Buffer.from('hello admin panel');
    expect(twoFactor.base32Decode(twoFactor.base32Encode(buf)).equals(buf)).toBe(true);
    const secret = twoFactor.generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(twoFactor.base32Decode(secret)).toHaveLength(20);
  });

  test('otpauth URI carries issuer and account', () => {
    const uri = twoFactor.otpauthUri(RFC_SECRET, 'ops@buildrshq.com');
    expect(uri).toMatch(/^otpauth:\/\/totp\/BuildrsHQ%3Aops%40buildrshq\.com\?secret=GEZD/);
    expect(uri).toContain('issuer=BuildrsHQ');
  });
});

describe('method selection', () => {
  test('admins always have email available when 2FA is enforced', () => {
    expect(twoFactor.chooseMethod({ twoFactor: {} }, [], 'admin')).toBe('email');
  });
  test('prefers an enrolled authenticator when allowed', () => {
    expect(twoFactor.chooseMethod({ twoFactor: { totpEnabled: true } }, ['email', 'authenticator'], 'user')).toBe('authenticator');
  });
  test('falls back to email when the authenticator is not enrolled', () => {
    expect(twoFactor.chooseMethod({ twoFactor: {} }, ['email', 'authenticator'], 'user')).toBe('email');
  });
  test('returns null when no allowed method fits a user', () => {
    expect(twoFactor.chooseMethod({ twoFactor: {} }, ['authenticator'], 'user')).toBeNull();
  });
  test('masks email addresses', () => {
    expect(twoFactor.maskEmail('daniel@buildrshq.com')).toBe('da••••@buildrshq.com');
  });
});
