// Verifies the Vapi configuration before you send anyone an interview link.
// Run: npm run preflight
import { listAssistants, getPhoneNumber, webhookServer } from '../lib/vapi.ts';

const problems: string[] = [];

if (!process.env.VAPI_PRIVATE_KEY) {
  console.error('✗ VAPI_PRIVATE_KEY is not set in .env.local.');
  process.exit(1);
}

try {
  const assistants = await listAssistants();
  console.log(`✓ Private key accepted. ${assistants.length} assistant(s) on the org.`);
  const configured = process.env.VAPI_ASSISTANT_ID;
  if (!configured) problems.push('VAPI_ASSISTANT_ID is not set — run `npm run seed:agent`.');
  else if (!assistants.some((a) => a.id === configured)) problems.push(`VAPI_ASSISTANT_ID ${configured} is not on this org.`);
  else console.log('✓ VAPI_ASSISTANT_ID resolves.');
} catch (err) {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

if (!process.env.VAPI_PUBLIC_KEY) problems.push('VAPI_PUBLIC_KEY is not set — interview links will not work.');
else console.log('✓ VAPI_PUBLIC_KEY set.');

const phoneId = process.env.VAPI_PHONE_NUMBER_ID;
if (!phoneId) {
  console.log('· VAPI_PHONE_NUMBER_ID not set — phone calls disabled, interview links only.');
} else {
  try {
    const n = await getPhoneNumber(phoneId);
    console.log(`✓ Phone number ${n.number ?? n.id} resolves. Free Vapi numbers dial US only; +91 needs an imported Indian SIP/carrier number.`);
  } catch (err) {
    problems.push(`VAPI_PHONE_NUMBER_ID does not resolve: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(webhookServer() ? '✓ Webhooks configured.' : '· Webhooks off (needs https APP_URL + VAPI_WEBHOOK_SECRET) — polling only.');

if (problems.length > 0) {
  console.error('\nBlockers:');
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exitCode = 1;
} else {
  console.log('\nPreflight passed.');
}
