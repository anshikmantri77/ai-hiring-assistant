import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getCall } from '@/lib/hunar';
import { message } from '@/lib/http';

type Params = { params: Promise<{ event: string }> };

const EVENTS = new Set(['status', 'result', 'recording', 'summary']);

/**
 * Receives Hunar's status/result/recording/summary callbacks.
 *
 * The payload shape differs per event, so rather than parse four shapes we use
 * it only to identify the call, then re-read the authoritative record from
 * Hunar. `summary` is the exception: it is not on the call-detail response, so
 * it is taken from the payload when present.
 */
export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  const { event } = await params;
  if (!EVENTS.has(event)) {
    return NextResponse.json({ error: 'Unknown event.' }, { status: 404 });
  }

  const expected = process.env.WEBHOOK_TOKEN;
  const token = new URL(req.url).searchParams.get('token');
  // Public endpoint — an unauthenticated caller could otherwise rewrite call rows.
  if (!expected || token !== expected) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }

  try {
    const payload = (await req.json()) as Record<string, unknown>;
    const callId = extractCallId(payload);
    if (!callId) {
      console.error(`Hunar ${event} webhook had no call id`, payload);
      return NextResponse.json({ error: 'No call id in payload.' }, { status: 400 });
    }

    // Ignore callbacks for calls this deployment did not create.
    const [known] = await sql<{ id: string }[]>`select id from calls where id = ${callId}`;
    if (!known) return NextResponse.json({ ignored: true });

    const detail = await getCall(callId);
    const summary = event === 'summary' ? extractSummary(payload) : null;

    await sql`
      update calls set
        status            = ${detail.status},
        result            = ${detail.result ? sql.json(detail.result) : null},
        recording_url     = ${detail.recording_url},
        engagement_status = ${detail.engagement_status},
        answered_by       = ${detail.answered_by},
        duration_seconds  = ${detail.duration_seconds},
        summary           = coalesce(${summary}, summary),
        updated_at        = now()
      where id = ${callId}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`Hunar ${event} webhook failed`, err);
    return NextResponse.json({ error: message(err) }, { status: 500 });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Hunar has not pinned a callback body shape, so accept the plausible keys. */
function extractCallId(payload: Record<string, unknown>): string | null {
  const nested = payload.data;
  const sources = [payload, typeof nested === 'object' && nested ? (nested as Record<string, unknown>) : {}];
  for (const source of sources) {
    for (const key of ['call_id', 'callId', 'id']) {
      const value = source[key];
      if (typeof value === 'string' && UUID.test(value)) return value;
    }
  }
  return null;
}

function extractSummary(payload: Record<string, unknown>): string | null {
  const nested = payload.data;
  const sources = [payload, typeof nested === 'object' && nested ? (nested as Record<string, unknown>) : {}];
  for (const source of sources) {
    const value = source.summary ?? source.call_summary;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}
