import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Pinged daily by Vercel Cron (vercel.json). Keeps a free-tier Postgres from
 * pausing for inactivity — the cause of the site-wide 500 — and doubles as an
 * uptime check.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await sql`select 1`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Health check failed', err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
