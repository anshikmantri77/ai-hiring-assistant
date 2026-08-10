/**
 * Points one existing candidate row at a real phone number, for the live test.
 *
 *   npm run set-phone -- "Rohan Mehta" +919876543210
 *
 * The number goes into the database only. It never touches
 * data/candidates.sample.json, so it cannot reach git. Re-running sourcing
 * will not overwrite it either: the (job_id, phone) upsert is DO NOTHING, and
 * the sample row's original number no longer matches this row.
 */
import postgres from 'postgres';

const [name, phone] = process.argv.slice(2);

if (!name || !phone) {
  console.error('Usage: npm run set-phone -- "<candidate name>" <+91XXXXXXXXXX>');
  process.exit(1);
}
if (!/^\+91\d{10}$/.test(phone)) {
  console.error('Phone must be a +91 number in E.164 form, e.g. +919876543210');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
  process.exit(1);
}

const masked = `${phone.slice(0, 5)}…${phone.slice(-2)}`;
const sql = postgres(process.env.DATABASE_URL, {
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : 'require',
  max: 1,
});

try {
  // Scope to the newest job. Matching by name alone spans every job, which
  // picks a stale row and can collide with the (job_id, phone) unique index.
  const [job] = await sql`select id, title from jobs order by created_at desc limit 1`;
  if (!job) {
    console.error('No jobs yet. Create one and run sourcing first.');
    process.exit(1);
  }

  const rows = await sql`
    update candidates set phone = ${phone}
     where job_id = ${job.id} and name = ${name}
     returning id, name
  `;
  if (rows.length === 0) {
    console.error(`No candidate named "${name}" on the latest job ("${job.title}").`);
    console.error('Run sourcing on that job first, then re-run this.');
    process.exitCode = 1;
  } else {
    console.log(`Job "${job.title}": updated ${rows[0].name} -> ${masked}`);
    console.log('This row is now the one that will actually ring. Select only it.');
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('Update failed:', msg);
  if (msg.includes('candidates_job_id_phone_key')) {
    console.error('Another candidate on this job already has that number — pick a different name.');
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
