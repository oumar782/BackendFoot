import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { isAdmin, isManager, requireAuth } from '../middleware/auth.js';
import { tenantFilter } from '../middleware/tenant.js';

process.env.JWT_SECRET = 'test-secret';

test('JWT supplies a server-owned manager identity', () => {
  const token = jwt.sign({ userId: 11, role: 'gestionnaire', managerId: 11 }, process.env.JWT_SECRET);
  const req = { get: () => `Bearer ${token}` };
  let nextCalled = false;
  requireAuth(req, {}, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.deepEqual(req.user, { userId: 11, role: 'gestionnaire', managerId: 11 });
});

test('manager tenant predicate ignores client supplied identifiers', () => {
  const scoped = tenantFilter({ user: { role: 'gestionnaire', managerId: 11 } }, 't.manager_id', ['untrusted-manager-id']);
  assert.equal(scoped.sql, ' AND t.manager_id = $2');
  assert.deepEqual(scoped.params, ['untrusted-manager-id', 11]);
  assert.equal(isManager({ role: 'gestionnaire' }), true);
  assert.equal(isAdmin({ role: 'gestionnaire' }), false);
});

test('administrator does not receive a tenant restriction', () => {
  const scoped = tenantFilter({ user: { role: 'administrateur' } }, 't.manager_id');
  assert.equal(scoped.sql, '');
  assert.deepEqual(scoped.params, []);
});
