// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStatus, callFields, spoken } from './vapi.ts';
import { isSettled } from './call-state.ts';

test('in-flight Vapi statuses never read as settled', () => {
  for (const status of ['scheduled', 'queued', 'ringing', 'in-progress', 'forwarding', 'something-new']) {
    assert.equal(isSettled(canonicalStatus({ status })), false, status);
  }
});

test('ended calls map by endedReason', () => {
  const ended = (endedReason: string) => canonicalStatus({ status: 'ended', endedReason });
  assert.equal(ended('customer-ended-call'), 'COMPLETED');
  assert.equal(ended('assistant-ended-call'), 'COMPLETED');
  assert.equal(ended('silence-timed-out'), 'COMPLETED');
  assert.equal(ended('customer-did-not-answer'), 'NOT_CONNECTED');
  assert.equal(ended('customer-busy'), 'NOT_CONNECTED');
  assert.equal(ended('voicemail'), 'NOT_CONNECTED');
  assert.equal(ended('customer-did-not-give-microphone-permission'), 'NOT_CONNECTED');
  assert.equal(ended('pipeline-error-openai-llm-failed'), 'FAILED');
  assert.equal(ended('manually-canceled'), 'CANCELLED');
  assert.equal(canonicalStatus({ status: 'ended' }), 'COMPLETED');
});

test('callFields merges the summary and computes duration', () => {
  const f = callFields({
    id: '00000000-0000-0000-0000-000000000000',
    type: 'webCall',
    status: 'ended',
    endedReason: 'customer-ended-call',
    startedAt: '2026-10-23T10:00:00.000Z',
    endedAt: '2026-10-23T10:02:05.000Z',
    artifact: { recordingUrl: 'https://example.com/r.wav' },
    analysis: { summary: 'Keen.', structuredData: { interested: true, notice_period: '30 days' } },
  });
  assert.equal(f.status, 'COMPLETED');
  assert.equal(f.duration_seconds, 125);
  assert.equal(f.answered_by, 'web');
  assert.equal(f.recording_url, 'https://example.com/r.wav');
  assert.deepEqual(f.result, { interested: true, notice_period: '30 days', summary: 'Keen.' });
});

test('no structured data means no result, even with a summary', () => {
  const f = callFields({ id: 'x', status: 'ended', analysis: { summary: 'Hung up.' } });
  assert.equal(f.result, null);
  assert.equal(f.duration_seconds, null);
});

test('spoken() strips template braces and line breaks, and falls back', () => {
  assert.equal(spoken('Acme {{ignore}}\nCorp', 'x'), 'Acme ignore Corp');
  assert.equal(spoken('   ', 'the hiring team'), 'the hiring team');
  assert.equal(spoken(null, 'fallback'), 'fallback');
  assert.equal(spoken('a'.repeat(200), 'x').length, 80);
});
