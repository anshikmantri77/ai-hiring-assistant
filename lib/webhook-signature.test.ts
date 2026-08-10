// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignature, verifySignature } from './webhook-signature.ts';

const KEY = 'hunar_test_key_abc123';
const BODY = '{"event_type":"call_summary","call_id":"11111111-2222-3333-4444-555555555555"}';
const NOW = 1_786_000_000_000; // fixed clock
const TS = String(Math.floor(NOW / 1000));

const valid = () => ({
  signatureHeader: computeSignature(KEY, TS, BODY),
  timestampHeader: TS,
  rawBody: BODY,
  trustedKeys: [KEY],
  now: NOW,
});

test('accepts a correctly signed payload', () => {
  assert.deepEqual(verifySignature(valid()), { ok: true });
});

test('rejects a tampered body', () => {
  const v = { ...valid(), rawBody: BODY.replace('call_summary', 'call_result') };
  assert.deepEqual(verifySignature(v), { ok: false, reason: 'mismatch' });
});

test('rejects a signature made with the wrong key', () => {
  const v = { ...valid(), signatureHeader: computeSignature('other_key', TS, BODY) };
  assert.deepEqual(verifySignature(v), { ok: false, reason: 'mismatch' });
});

test('rejects a replayed timestamp outside the tolerance window', () => {
  // Same signature, but the clock has moved on past 300s.
  assert.deepEqual(verifySignature({ ...valid(), now: NOW + 301_000 }), { ok: false, reason: 'stale' });
  assert.deepEqual(verifySignature({ ...valid(), now: NOW + 299_000 }), { ok: true });
});

test('accepts when one of several comma-separated segments matches', () => {
  // Hunar sends one digest per active API key; order need not match ours.
  const header = [computeSignature('unrelated', TS, BODY), computeSignature(KEY, TS, BODY)].join(',');
  assert.deepEqual(verifySignature({ ...valid(), signatureHeader: header }), { ok: true });
});

test('fails closed when headers or keys are missing', () => {
  assert.deepEqual(verifySignature({ ...valid(), trustedKeys: [] }), { ok: false, reason: 'no-keys' });
  assert.deepEqual(verifySignature({ ...valid(), signatureHeader: null }), { ok: false, reason: 'missing-signature' });
  assert.deepEqual(verifySignature({ ...valid(), timestampHeader: null }), { ok: false, reason: 'missing-timestamp' });
  assert.deepEqual(verifySignature({ ...valid(), timestampHeader: 'not-a-number' }), {
    ok: false,
    reason: 'missing-timestamp',
  });
});

test('signature is not vulnerable to a length-mismatched comparison', () => {
  assert.deepEqual(verifySignature({ ...valid(), signatureHeader: 'short' }), { ok: false, reason: 'mismatch' });
});
