import { sql } from './db';
import { getCall, callFields } from './vapi';

/**
 * Re-reads one call from Vapi and stores it. Shared by dashboard polling and
 * the webhook so the two can never write different shapes. `webhook_events`
 * is incremented only on the webhook path — a non-zero value proves callbacks
 * arrive.
 */
export async function syncCall(callId: string, fromWebhook = false): Promise<void> {
  const f = callFields(await getCall(callId));
  await sql`
    update calls set
      status            = ${f.status},
      result            = ${f.result ? sql.json(f.result) : null},
      recording_url     = ${f.recording_url},
      engagement_status = ${f.engagement_status},
      answered_by       = ${f.answered_by},
      duration_seconds  = ${f.duration_seconds},
      webhook_events    = webhook_events + ${fromWebhook ? 1 : 0},
      updated_at        = now()
    where id = ${callId}
  `;
}
