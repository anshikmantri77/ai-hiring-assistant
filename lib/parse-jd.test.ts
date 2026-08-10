// Run: npm test   (exercises the no-LLM path, which is what the demo ships with)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJd } from './parse-jd.ts';

const JD = `Senior Field Sales Executive
We are hiring at Gigstaan for our Bangalore team.
You will do B2B sales and cold calling. Salesforce CRM experience required.
7+ years of experience preferred.`;

test('keyword fallback extracts the core fields', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const parsed = await parseJd(JD);

  assert.equal(parsed.title, 'Senior Field Sales Executive');
  assert.equal(parsed.location, 'Bangalore');
  assert.equal(parsed.seniority, 'Senior');
  assert.ok(parsed.skills.includes('b2b sales'));
  assert.ok(parsed.skills.includes('salesforce'));
});

test('company stops at the first lowercase word, not the end of the sentence', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  // This value is spoken aloud in the call intro, so an over-greedy match is
  // audible, not just cosmetic.
  assert.equal((await parseJd(JD)).company, 'Gigstaan');
  assert.equal((await parseJd('Role at Acme Corp India for the Pune office.')).company, 'Acme Corp India');
  assert.equal((await parseJd('Sales role. No employer named here at all.')).company, '');
});

test('empty description does not throw', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const parsed = await parseJd('');
  assert.equal(parsed.title, 'Untitled role');
  assert.deepEqual(parsed.skills, []);
});
