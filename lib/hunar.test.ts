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

// --- polling lifecycle -------------------------------------------------------
import { needsRefresh } from './call-state.ts';

const now = Date.parse('2026-08-10T12:00:00Z');
const at = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();

test('keeps polling a call that is still running', () => {
  assert.equal(
    needsRefresh({ status: 'IN_PROGRESS', result: null, recording_url: null, created_at: at(1) }, now),
    true,
  );
});

test('keeps polling COMPLETED until the result payload lands', () => {
  // Hunar fills result and recording seconds after the call ends. Stopping at
  // COMPLETED left the answers permanently empty on the demo path.
  assert.equal(
    needsRefresh({ status: 'COMPLETED', result: {}, recording_url: null, created_at: at(1) }, now),
    true,
  );
  assert.equal(
    needsRefresh({ status: 'COMPLETED', result: { interested: true }, recording_url: null, created_at: at(1) }, now),
    true,
  );
});

test('stops once the result and recording are both present', () => {
  assert.equal(
    needsRefresh({ status: 'COMPLETED', result: { interested: true }, recording_url: 'https://x/a.wav', created_at: at(1) }, now),
    false,
  );
});

test('gives up on a call that never produces a payload', () => {
  assert.equal(
    needsRefresh({ status: 'NOT_CONNECTED', result: {}, recording_url: null, created_at: at(60) }, now),
    false,
  );
});
