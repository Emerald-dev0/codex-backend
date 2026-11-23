jest.mock('../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => {
    req.userId = 'user-1';
    next();
  },
}));

jest.mock('../middleware/permissionMatrix', () => ({
  requirePermission: jest.fn(() => (_req, _res, next) => next()),
}));

jest.mock('../utils/gitService', () => ({
  merge: jest.fn(async () => ({ success: true, result: {} })),
}));

jest.mock('../models/Company', () => ({
  findById: jest.fn(() => ({
    select: async () => ({ owner: 'user-1', members: [] }),
  })),
}));

const express = require('express');
const request = require('supertest');
const permissionMatrix = require('../middleware/permissionMatrix');
const gitService = require('../utils/gitService');
const gitRoutes = require('../routes/git');

// Route definitions run at import time; capture the scopes they asked for
// before any beforeEach clears the mock history.
const permissionScopesRequested = permissionMatrix.requirePermission.mock.calls.map(
  ([resource, action]) => `${resource}:${action}`
);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/git', gitRoutes);
  return app;
}

describe('POST /api/git/merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('is guarded by the git:merge permission', () => {
    expect(permissionScopesRequested).toContain('git:merge');
  });

  test('refuses to merge an agent branch through the REST route', async () => {
    const res = await request(buildApp())
      .post('/api/git/merge')
      .send({ workspaceId: 'ws-1', branchName: 'agent/task-42' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/approval flow/i);
    expect(gitService.merge).not.toHaveBeenCalled();
  });

  test('merges a normal branch', async () => {
    const res = await request(buildApp())
      .post('/api/git/merge')
      .send({ workspaceId: 'ws-1', branchName: 'feature/login' });

    expect(res.status).toBe(200);
    expect(gitService.merge).toHaveBeenCalledWith('ws-1', 'feature/login', null);
  });

  test('still validates required fields', async () => {
    const res = await request(buildApp())
      .post('/api/git/merge')
      .send({ workspaceId: 'ws-1' });

    expect(res.status).toBe(400);
    expect(gitService.merge).not.toHaveBeenCalled();
  });
});

describe('permission matrix scopes', () => {
  test('git:merge exists and covers every tier', () => {
    const matrix = jest.requireActual('../middleware/permissionMatrix');
    expect(matrix.scopes['git:merge']).toEqual(matrix.scopes['git:branch']);
  });
});
