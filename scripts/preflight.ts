// Verifies the Hunar key works and the org can actually dial +91 numbers,
// before you spend time on a call that would fail with a 400.
// Run: npm run preflight
import { listAgents, listNumbers } from '../lib/hunar.ts';

const problems = [];

if (!process.env.HUNAR_API_KEY) {
  console.error('✗ HUNAR_API_KEY is not set in .env.local.');
  process.exit(1);
}

try {
  const { results: agents } = await listAgents();
  console.log(`✓ Key accepted. ${agents.length} agent(s) on the org.`);

  const configured = process.env.HUNAR_AGENT_ID;
  if (!configured) {
    problems.push('HUNAR_AGENT_ID is not set — run `npm run seed:agent`.');
  } else if (!agents.some((a) => a.id === configured)) {
    problems.push(`HUNAR_AGENT_ID ${configured} is not an agent on this org.`);
  } else {
    console.log(`✓ HUNAR_AGENT_ID resolves to an agent on this org.`);
  }
} catch (err) {
  // A bad key surfaces here as a 401/403 — the single most useful early signal.
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

try {
  const { results: numbers } = await listNumbers();
  if (numbers.length === 0) {
    problems.push('No from-numbers on the org — POST /calls/ will fail with a 400.');
  }
  for (const n of numbers) {
    const dialsIndia = n.allowed_countries.includes('IN');
    const flags = [
      n.is_default ? 'default' : null,
      n.is_validated ? 'validated' : 'NOT VALIDATED',
      dialsIndia ? 'can dial IN' : 'cannot dial IN',
    ].filter(Boolean);
    console.log(`  ${n.phone_number} (${n.country_code}) — ${flags.join(', ')}`);
  }
  if (numbers.length > 0 && !numbers.some((n) => n.allowed_countries.includes('IN') && n.is_validated)) {
    problems.push('No validated from-number allows calling IN — a +91 callee will be rejected.');
  } else if (numbers.length > 0) {
    console.log('✓ A validated from-number can dial +91.');
  }
} catch (err) {
  problems.push(`Could not list from-numbers: ${err instanceof Error ? err.message : err}`);
}

if (problems.length > 0) {
  console.error('\nBlockers:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log('\nPreflight passed — safe to launch a live call.');
}
