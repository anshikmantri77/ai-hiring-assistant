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
  const rows = await sql`
    update candidates set phone = ${phone}
     where id = (select id from candidates where name = ${name} order by created_at limit 1)
     returning id, name
  `;
  if (rows.length === 0) {
    console.error(`No candidate named "${name}". Run sourcing first, then re-run this.`);
    process.exitCode = 1;
  } else {
    console.log(`Updated ${rows[0].name} -> ${masked}`);
    console.log('This row is now the one that will actually ring. Select only it.');
  }
} catch (err) {
  console.error('Update failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await sql.end();
}
