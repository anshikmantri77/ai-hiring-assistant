'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function JobForm() {
  const router = useRouter();
  const [rawJd, setRawJd] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawJd }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !body.id) throw new Error(body.error ?? 'Could not create the job.');
      router.push(`/jobs/${body.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the job.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        value={rawJd}
        onChange={(e) => setRawJd(e.target.value)}
        rows={10}
        placeholder="Paste the full job description here…"
        className="w-full resize-y rounded-lg border border-line bg-panel px-4 py-3 text-sm leading-relaxed outline-none placeholder:text-muted focus:border-accent"
      />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending || rawJd.trim().length < 20}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? 'Parsing…' : 'Parse job description'}
      </button>
    </form>
  );
}
