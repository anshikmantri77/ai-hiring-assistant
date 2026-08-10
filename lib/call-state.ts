/**
 * When a call still needs refreshing. Shared by the polling route and the
 * dashboard so the two cannot disagree about what "done" means.
 *
 * Pure — no env access, no imports — so the client bundle can use it.
 */

const SETTLED = new Set(['COMPLETED', 'NOT_CONNECTED', 'CANCELLED', 'FAILED']);

export function normalizeStatus(status: string): string {
  return status.trim().toUpperCase().replace(/[^A-Z]+/g, '_');
}

export function isSettled(status: string | null | undefined): boolean {
  return status ? SETTLED.has(normalizeStatus(status)) : false;
}

/**
 * Hunar fills `result` and `recording_url` asynchronously, some seconds after
 * the call reaches COMPLETED. Treating a terminal status as "finished" stops
 * polling too early and leaves the answers permanently empty, so keep going
 * until the payload actually lands — bounded, so a call that never produces
 * one is not chased forever.
 */
const GRACE_MS = 15 * 60 * 1000;

export type RefreshableCall = {
  status: string;
  result: Record<string, unknown> | null;
  recording_url: string | null;
  created_at: string | Date;
};

export function needsRefresh(call: RefreshableCall, now = Date.now()): boolean {
  if (!isSettled(call.status)) return true;

  const hasResult = call.result != null && Object.keys(call.result).length > 0;
  // NOT_CONNECTED and CANCELLED calls never produce either, so the grace
  // window is what stops them from being polled indefinitely.
  if (hasResult && call.recording_url) return false;

  return now - new Date(call.created_at).getTime() < GRACE_MS;
}
