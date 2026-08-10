import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Hunar signs every webhook. Per their docs, the signed message is
 * `{X-Hunar-Timestamp}.` followed by the raw request body, HMAC-SHA256 keyed
 * with an API key, base64-encoded. `X-Hunar-Signature` may carry several
 * comma-separated digests when an org has more than one active key, and a
 * match against any of them is valid.
 */

/** Reject replays. Hunar's own example uses the same window. */
const TOLERANCE_SECONDS = 300;

export function computeSignature(apiKey: string, timestamp: string, rawBody: string): string {
  const message = Buffer.concat([Buffer.from(`${timestamp.trim()}.`, 'utf8'), Buffer.from(rawBody, 'utf8')]);
  return createHmac('sha256', apiKey).update(message).digest('base64');
}

/** Constant-time compare that tolerates unequal lengths without throwing. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

export type SignatureResult =
  | { ok: true }
  | { ok: false; reason: 'no-keys' | 'missing-signature' | 'missing-timestamp' | 'stale' | 'mismatch' };

export function verifySignature(opts: {
  signatureHeader: string | null;
  timestampHeader: string | null;
  rawBody: string;
  trustedKeys: string[];
  now?: number;
}): SignatureResult {
  const { signatureHeader, timestampHeader, rawBody, trustedKeys } = opts;
  const now = opts.now ?? Date.now();

  if (trustedKeys.length === 0) return { ok: false, reason: 'no-keys' };
  if (!signatureHeader?.trim()) return { ok: false, reason: 'missing-signature' };
  if (!timestampHeader?.trim()) return { ok: false, reason: 'missing-timestamp' };

  const sent = Number(timestampHeader.trim());
  if (!Number.isFinite(sent)) return { ok: false, reason: 'missing-timestamp' };
  if (Math.abs(now / 1000 - sent) > TOLERANCE_SECONDS) return { ok: false, reason: 'stale' };

  const segments = signatureHeader.split(',').map((s) => s.trim()).filter(Boolean);
  for (const key of trustedKeys) {
    const expected = computeSignature(key, timestampHeader, rawBody);
    // Compare against every segment, not just the first — segment order does
    // not have to line up with our key order.
    for (const segment of segments) {
      if (safeEqual(segment, expected)) return { ok: true };
    }
  }
  return { ok: false, reason: 'mismatch' };
}
