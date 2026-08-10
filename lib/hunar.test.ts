// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, isSettled } from './hunar.ts';

test('normalizes both the enum spelling and the human label', () => {
  assert.equal(normalizeStatus('COMPLETED'), 'COMPLETED');
  assert.equal(normalizeStatus('Not Connected'), 'NOT_CONNECTED');
  assert.equal(normalizeStatus('In Progress'), 'IN_PROGRESS');
  assert.equal(normalizeStatus(' completed '), 'COMPLETED');
});

test('terminal states settle whichever spelling arrives', () => {
  for (const s of ['COMPLETED', 'Not Connected', 'CANCELLED', 'Failed']) {
    assert.equal(isSettled(s), true, `${s} should be terminal`);
  }
});

test('in-flight states keep polling', () => {
  for (const s of ['RINGING', 'In Progress', 'INITIATED', 'NOT_STARTED', 'Scheduled']) {
    assert.equal(isSettled(s), false, `${s} should not be terminal`);
  }
});

test('a missing status never reads as settled and never throws', () => {
  assert.equal(isSettled(null), false);
  assert.equal(isSettled(undefined), false);
  assert.equal(isSettled(''), false);
});
