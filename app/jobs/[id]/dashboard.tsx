'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CandidateRow } from '@/lib/db';
import { needsRefresh, normalizeStatus } from '@/lib/call-state';

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'border-accent/40 text-accent',
  IN_PROGRESS: 'border-sky-400/40 text-sky-300',
  RINGING: 'border-sky-400/40 text-sky-300',
  INITIATED: 'border-sky-400/40 text-sky-300',
  NOT_CONNECTED: 'border-amber-400/40 text-amber-300',
  CANCELLED: 'border-line text-muted',
  FAILED: 'border-red-400/40 text-red-300',
};

export function Dashboard({ jobId, initial }: { jobId: string; initial: CandidateRow[] }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | 'sourcing' | 'calling'>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}/calls`, { cache: 'no-store' });
    const body = (await res.json()) as { candidates?: CandidateRow[]; error?: string };
    if (!res.ok) throw new Error(body.error ?? 'Could not refresh the dashboard.');
    setRows(body.candidates ?? []);
  }, [jobId]);

  // Poll only while something is actually in flight, so an idle dashboard is quiet.
  const inFlight = rows.some((r) => r.call && needsRefresh(r.call));
  useEffect(() => {
    if (!inFlight) return;
    const timer = setInterval(() => {
      refresh().catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Refresh failed.'),
      );
    }, 10_000);
    return () => clearInterval(timer);
  }, [inFlight, refresh]);

  async function source() {
    setBusy('sourcing');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/source`, { method: 'POST' });
      const body = (await res.json()) as { found?: number; added?: number; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Sourcing failed.');
      setNotice(`Found ${body.found}, added ${body.added} new.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sourcing failed.');
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    setBusy('calling');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/calls`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateIds: [...selected] }),
      });
      const body = (await res.json()) as {
        launched?: number;
        failed?: { error: string }[];
        webhooksEnabled?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? 'Could not launch calls.');

      const parts = [`Launched ${body.launched} call${body.launched === 1 ? '' : 's'}.`];
      if (body.failed?.length) parts.push(`${body.failed.length} failed: ${body.failed[0].error}`);
      if (!body.webhooksEnabled) parts.push('APP_URL is not a public https origin — polling Hunar instead of webhooks.');
      setNotice(parts.join(' '));

      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not launch calls.');
    } finally {
      setBusy(null);
    }
  }

  function toggle(id: string) {
    // A candidate with no number cannot be dialled; keep it out of the selection
    // rather than letting the launch fail server-side.
    if (!rows.find((r) => r.id === id)?.phone) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={source}
          disabled={busy !== null}
          className="rounded-lg border border-line bg-panel px-3.5 py-2 text-sm transition-colors hover:border-accent disabled:opacity-40"
        >
          {busy === 'sourcing' ? 'Sourcing…' : 'Source candidates'}
        </button>
        <button
          onClick={launch}
          disabled={busy !== null || selected.size === 0}
          className="rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'calling' ? 'Launching…' : `Screen ${selected.size || ''} selected`.trim()}
        </button>
        {inFlight && <span className="text-xs text-muted">Refreshing every 10s…</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-400/40 bg-red-400/5 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-muted">{notice}</p>}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-muted">
          No candidates yet — run sourcing above.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <CandidateCard
              key={row.id}
              row={row}
              checked={selected.has(row.id)}
              onToggle={() => toggle(row.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CandidateCard({
  row,
  checked,
  onToggle,
}: {
  row: CandidateRow;
  checked: boolean;
  onToggle: () => void;
}) {
  const call = row.call;
  const status = call ? normalizeStatus(call.status) : '';
  const result = call?.result ?? null;

  return (
    <li className="rounded-lg border border-line bg-panel px-4 py-3.5">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={!row.phone}
          aria-label={
            row.phone ? `Select ${row.name}` : `${row.name} has no phone number and cannot be screened`
          }
          className="mt-1 size-4 accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-30"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{row.name}</span>
            {row.phone ? (
              <span className="text-xs text-muted">{row.phone}</span>
            ) : (
              <span className="text-xs text-amber-300/80">no phone — not callable</span>
            )}
            {row.linkedin && (
              <a
                href={row.linkedin}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-accent underline-offset-2 hover:underline"
              >
                LinkedIn
              </a>
            )}
          </div>
          <p className="truncate text-xs text-muted">
            {[row.title, row.company, row.location].filter(Boolean).join(' · ')}
          </p>
        </div>

        {call && (
          <span
            className={`shrink-0 rounded border px-2 py-0.5 text-xs ${STATUS_STYLE[status] ?? 'border-line text-muted'}`}
          >
            {status.replace(/_/g, ' ').toLowerCase()}
          </span>
        )}
      </div>

      {call && (
        <div className="mt-3 space-y-2 border-t border-line pt-3 pl-7">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <Field label="Interested" value={formatValue(result?.interested)} />
            <Field label="Notice" value={formatValue(result?.notice_period)} />
            <Field label="Expected CTC" value={formatValue(result?.expected_ctc)} />
            <Field label="Available" value={formatValue(result?.availability)} />
            <Field label="Engagement" value={formatValue(call.engagement_status)} />
            <Field label="Answered by" value={formatValue(call.answered_by)} />
            <Field
              label="Duration"
              value={call.duration_seconds ? `${Math.round(Number(call.duration_seconds))}s` : '—'}
            />
          </dl>

          {(call.summary || typeof result?.summary === 'string') && (
            <p className="text-xs leading-relaxed text-muted">
              {call.summary ?? String(result?.summary)}
            </p>
          )}

          {call.recording_url && (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- call recordings have no transcript track
            <audio controls preload="none" src={call.recording_url} className="mt-1 h-8 w-full max-w-sm" />
          )}
        </div>
      )}
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === '-') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
