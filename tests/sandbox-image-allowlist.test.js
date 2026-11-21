jest.mock('dockerode', () => {
  const createContainer = jest.fn();
  const version = jest.fn().mockResolvedValue({ Version: '24.0.0' });
  const Docker = jest.fn(() => ({ createContainer, version }));
  Docker.__mock = { createContainer, version };
  return Docker;
});

const Docker = require('dockerode');
const sandboxSecurity = require('../utils/sandboxSecurity');
const containerWorker = require('../utils/containerWorker');
const sandboxExecutor = require('../utils/sandboxExecutor');

describe('sandbox image allowlist', () => {
  const originalDocker = sandboxSecurity.docker;
  const originalContainers = sandboxSecurity.containers;

  afterEach(() => {
    sandboxSecurity.docker = originalDocker;
    sandboxSecurity.containers = originalContainers;
    jest.clearAllMocks();
  });

  test('rejects a well-formed image from an untrusted registry', async () => {
    const createContainer = jest.fn();
    sandboxSecurity.docker = { createContainer };

    await expect(
      sandboxSecurity.createIsolatedContainer('user-a', 'workspace-a', {
        image: 'attacker/backdoored-node:latest',
      })
    ).rejects.toThrow('Sandbox image not permitted');

    expect(createContainer).not.toHaveBeenCalled();
  });

  test('rejects a malformed image name', async () => {
    sandboxSecurity.docker = { createContainer: jest.fn() };

    await expect(
      sandboxSecurity.createIsolatedContainer('user-b', 'workspace-b', {
        image: 'node:18-alpine && rm -rf /',
      })
    ).rejects.toThrow('Invalid sandbox image');
  });

  test('runs an allowlisted image', async () => {
    const container = { remove: jest.fn(), inspect: jest.fn() };
    const createContainer = jest.fn().mockResolvedValue(container);
    sandboxSecurity.docker = { createContainer };

    const created = await sandboxSecurity.createIsolatedContainer('user-c', 'workspace-c', {
      image: 'python:3.11-alpine',
    });

    expect(created).toBe(container);
    expect(createContainer.mock.calls[0][0].Image).toBe('python:3.11-alpine');
  });

  test('every language image the executor asks for is allowlisted', () => {
    for (const language of ['javascript', 'js', 'python', 'java', 'go', 'rust', 'ruby', 'php', 'unknown']) {
      expect(() => sandboxExecutor.getDockerImage(language)).not.toThrow();
    }
  });

  test('containerWorker refuses an image outside the allowlist', async () => {
    const { createContainer } = Docker.__mock;
    containerWorker.dockerAvailable = true;

    const result = await containerWorker.provisionWorker('task-1', 'user-1', 'workspace-1', {
      image: 'attacker/backdoored-node:latest',
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not permitted/i);
    expect(createContainer).not.toHaveBeenCalled();
  });
});
