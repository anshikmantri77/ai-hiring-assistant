'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CandidateRow } from '@/lib/db';
import { needsRefresh, normalizeStatus } from '@/lib/call-state';

/**
 * Each call state owns a colour, so the board reads at a glance rather than
 * requiring you to parse the label. `edge` paints the card's status rail,
 * `chip` the badge.
 */
const STATE: Record<string, { edge: string; chip: string; live?: boolean }> = {
  COMPLETED: { edge: 'bg-live', chip: 'border-live text-live' },
  IN_PROGRESS: { edge: 'bg-ring', chip: 'border-ring text-ring', live: true },
  RINGING: { edge: 'bg-ring', chip: 'border-ring text-ring', live: true },
  INITIATED: { edge: 'bg-ring', chip: 'border-ring text-ring', live: true },
  SCHEDULED: { edge: 'bg-ring', chip: 'border-ring text-ring', live: true },
  NOT_STARTED: { edge: 'bg-ring', chip: 'border-ring text-ring', live: true },
  NOT_CONNECTED: { edge: 'bg-dead', chip: 'border-dead text-dead' },
  FAILED: { edge: 'bg-dead', chip: 'border-dead text-dead' },
  CANCELLED: { edge: 'bg-mute', chip: 'border-mute text-mute' },
};

const BTN =
  'border-2 border-ink bg-card px-4 py-2.5 font-display text-sm font-semibold tracking-tight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-edge disabled:text-mute disabled:hover:translate-y-0';

export function Dashboard({ jobId, initial }: { jobId: string; initial: CandidateRow[] }) {
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<null | 'sourcing' | 'calling' | 'adding'>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
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
        skipped?: string[];
        webhooksEnabled?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? 'Could not launch calls.');

      const parts = [`Calling ${body.launched} ${body.launched === 1 ? 'person' : 'people'} now.`];
      if (body.skipped?.length) parts.push(`Already ringing: ${body.skipped.join(', ')}.`);
      if (body.failed?.length) parts.push(`${body.failed.length} failed: ${body.failed[0].error}`);
      if (!body.webhooksEnabled) parts.push('Results arrive by polling — APP_URL is not a public https origin.');
      setNotice(parts.join(' '));

      setSelected(new Set());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not launch calls.');
    } finally {
      setBusy(null);
    }
  }

  async function addCandidate(e: React.FormEvent) {
    e.preventDefault();
    setBusy('adding');
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/jobs/${jobId}/candidates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, phone: newPhone }),
      });
      const body = (await res.json()) as { name?: string; phone?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? 'Could not add the candidate.');
      setNotice(`Added ${body.name} (${body.phone}). Tick them, then Call.`);
      setNewName('');
      setNewPhone('');
      setAdding(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the candidate.');
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

  const callable = rows.filter((r) => r.phone).length;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <button onClick={source} disabled={busy !== null} className={BTN}>
          {busy === 'sourcing' ? 'Searching…' : 'Find candidates'}
        </button>
        <button onClick={() => setAdding((v) => !v)} disabled={busy !== null} className={BTN}>
          {adding ? 'Cancel' : 'Add by phone'}
        </button>
        <button
          onClick={launch}
          disabled={busy !== null || selected.size === 0}
          className="border-2 border-ink bg-dial px-4 py-2.5 font-display text-sm font-extrabold tracking-tight text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-edge disabled:bg-edge disabled:text-mute disabled:hover:translate-y-0"
        >
          {busy === 'calling'
            ? 'Dialling…'
            : selected.size > 0
              ? `Call ${selected.size} →`
              : 'Call selected'}
        </button>
        {inFlight && (
          <span className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-ring uppercase">
            <span className="is-live size-2 rounded-full bg-ring" aria-hidden />
            live · refreshing
          </span>
        )}
      </div>

      {adding && (
        <form onSubmit={addCandidate} className="border-2 border-ink bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-40 flex-1 flex-col gap-1 font-mono text-[11px] tracking-widest text-mute uppercase">
              name
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
                placeholder="Priya Sharma"
                className="border-2 border-edge bg-paper px-3 py-2 font-sans text-[15px] tracking-normal text-ink normal-case outline-none placeholder:text-mute/60 focus:border-dial"
              />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 font-mono text-[11px] tracking-widest text-mute uppercase">
              phone
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                required
                inputMode="tel"
                placeholder="9876543210"
                className="border-2 border-edge bg-paper px-3 py-2 font-mono text-[15px] tracking-normal text-ink outline-none placeholder:text-mute/60 focus:border-dial"
              />
            </label>
            <button
              type="submit"
              disabled={busy !== null}
              className="border-2 border-ink bg-live px-4 py-2.5 font-display text-sm font-extrabold tracking-tight text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-edge disabled:bg-edge disabled:text-mute"
            >
              {busy === 'adding' ? 'Adding…' : 'Add'}
            </button>
          </div>
          <p className="mt-3 text-xs text-mute">
            A 10-digit number is treated as Indian and gets +91. This person is callable
            straight away — profiles found by search have no number attached.
          </p>
        </form>
      )}

      {error && (
        <p role="alert" className="border-2 border-dead bg-dead/8 px-3.5 py-2.5 text-sm font-medium text-dead">
          {error}
        </p>
      )}
      {notice && (
        <p className="border-2 border-edge bg-card px-3.5 py-2.5 text-sm text-ink">{notice}</p>
      )}

      {rows.length === 0 ? (
        <div className="border-2 border-dashed border-edge px-4 py-14 text-center">
          <p className="font-display text-lg font-semibold tracking-tight">No candidates yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-mute">
            Hit <span className="font-semibold text-ink">Find candidates</span> to search from this
            description, or <span className="font-semibold text-ink">Add by phone</span> if you
            already have someone&apos;s number.
          </p>
        </div>
      ) : (
        <>
          <p className="font-mono text-[11px] tracking-widest text-mute uppercase">
            {rows.length} found · {callable} reachable
          </p>
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
        </>
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
  const state = STATE[status];
  const result = call?.result ?? null;
  const answered = typeof result?.interested === 'boolean';

  return (
    <li
      className={`flex border-2 bg-card transition-transform ${
        checked ? 'border-dial -translate-y-0.5' : 'border-ink'
      }`}
    >
      {/* Status rail — the board's primary signal. */}
      <span
        aria-hidden
        className={`w-1.5 shrink-0 ${state ? state.edge : 'bg-edge'} ${state?.live ? 'is-live' : ''}`}
      />

      <div className="min-w-0 flex-1 px-4 py-3.5">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            disabled={!row.phone}
            aria-label={
              row.phone ? `Select ${row.name}` : `${row.name} has no number and cannot be called`
            }
            className="mt-1 size-4 shrink-0 accent-[var(--color-dial)] disabled:cursor-not-allowed disabled:opacity-30"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-display text-[17px] font-semibold tracking-tight">
                {row.name}
              </span>
              {row.phone ? (
                <span className="font-mono text-xs text-mute">{row.phone}</span>
              ) : (
                <span className="border border-mute px-1.5 py-px font-mono text-[10px] tracking-widest text-mute uppercase">
                  no number
                </span>
              )}
              {row.linkedin && (
                <a
                  href={row.linkedin}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-mono text-[11px] tracking-wider text-dial uppercase underline-offset-2 hover:underline"
                >
                  linkedin ↗
                </a>
              )}
            </div>
            {[row.title, row.company, row.location].filter(Boolean).length > 0 && (
              <p className="mt-0.5 truncate text-[13px] text-mute">
                {[row.title, row.company, row.location].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {call && (
            <span
              className={`shrink-0 border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase ${
                state ? state.chip : 'border-edge text-mute'
              }`}
            >
              {status.replace(/_/g, ' ').toLowerCase()}
            </span>
          )}
        </div>

        {call && (
          <div className="mt-3.5 space-y-3 border-t-2 border-edge pt-3.5 pl-7">
            {answered ? (
              <dl className="grid max-w-2xl grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                <Answer
                  label="interested"
                  value={result?.interested ? 'Yes' : 'No'}
                  tone={result?.interested ? 'text-live' : 'text-mute'}
                />
                <Answer label="notice" value={text(result?.notice_period)} />
                <Answer label="expects" value={text(result?.expected_ctc)} />
                <Answer label="can start" value={text(result?.availability)} />
              </dl>
            ) : (
              <p className="font-mono text-[11px] tracking-widest text-mute uppercase">
                no answers extracted
              </p>
            )}

            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-[11px] tracking-wider text-mute uppercase">
              <span>{text(call.engagement_status).toLowerCase()}</span>
              <span>{text(call.answered_by).toLowerCase()}</span>
              <span>
                {call.duration_seconds ? `${Math.round(Number(call.duration_seconds))}s` : '—'}
              </span>
              {call.webhook_events > 0 && <span className="text-live">webhook ✓</span>}
            </div>

            {typeof result?.summary === 'string' && result.summary && (
              <p className="max-w-2xl text-[13px] leading-relaxed text-ink/75">{result.summary}</p>
            )}

            {call.recording_url && (
              // eslint-disable-next-line jsx-a11y/media-has-caption -- call recordings have no transcript track
              <audio controls preload="none" src={call.recording_url} className="h-9 w-full max-w-sm" />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** One extracted answer: tiny label, oversized value — a call-log readout. */
function Answer({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-widest text-mute uppercase">{label}</dt>
      <dd className={`mt-0.5 font-mono text-[15px] font-semibold ${tone ?? 'text-ink'}`}>
        {value}
      </dd>
    </div>
  );
}

function text(value: unknown): string {
  if (value === null || value === undefined || value === '' || value === '-') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
