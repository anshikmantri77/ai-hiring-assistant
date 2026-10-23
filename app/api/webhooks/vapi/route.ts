import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sql } from '@/lib/db';
import { syncCall } from '@/lib/sync-call';
import { message } from '@/lib/http';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Receives Vapi server messages (status-update, end-of-call-report).
 * Authenticated by the shared secret Vapi sends in `x-vapi-secret` (configured
 * on the assistant by scripts/seed-agent.ts). The payload is used only to
 * identify the call; state is re-read from Vapi, so duplicates and partial
 * payloads converge on the same row.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.VAPI_WEBHOOK_SECRET;
  const got = req.headers.get('x-vapi-secret') ?? '';
  if (!expected || !safeEqual(got, expected)) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as { message?: { type?: string; call?: { id?: unknown } } };
    const callId = body.message?.call?.id;
    // 200, not 4xx: a payload we cannot use will not become usable on retry.
    if (typeof callId !== 'string' || !UUID.test(callId)) {
      return NextResponse.json({ ignored: 'no call id' });
    }

    // A web call can report before the browser registers it; polling covers that.
    const [known] = await sql<{ id: string }[]>`select id from calls where id = ${callId}`;
    if (!known) return NextResponse.json({ ignored: 'unknown call' });

    await syncCall(callId, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Vapi webhook failed', err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}
