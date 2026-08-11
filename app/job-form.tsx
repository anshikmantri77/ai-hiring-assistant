'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function JobForm() {
  const router = useRouter();
  const [rawJd, setRawJd] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tooShort = rawJd.trim().length < 20;

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
      <div className="border-2 border-ink bg-card">
        <label htmlFor="jd" className="sr-only">
          Job description
        </label>
        <textarea
          id="jd"
          value={rawJd}
          onChange={(e) => setRawJd(e.target.value)}
          rows={9}
          placeholder={'Senior Backend Engineer\nBangalore. Java, Spring Boot, microservices. 6+ years.'}
          className="w-full resize-y bg-transparent px-4 py-3.5 text-[15px] leading-relaxed outline-none placeholder:text-mute/70"
        />
        <div className="flex items-center justify-between border-t border-edge px-4 py-2">
          <span className="font-mono text-[11px] tracking-wider text-mute uppercase">
            {rawJd.trim().length} chars
          </span>
          <span className="font-mono text-[11px] tracking-wider text-mute uppercase">
            {tooShort ? 'need 20+' : 'ready'}
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="border-2 border-dead bg-dead/8 px-3.5 py-2.5 text-sm font-medium text-dead">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || tooShort}
        className="w-full border-2 border-ink bg-dial px-5 py-3.5 font-display text-base font-extrabold tracking-tight text-white transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:border-edge disabled:bg-edge disabled:text-mute disabled:hover:translate-y-0 sm:w-auto"
      >
        {pending ? 'Reading it…' : 'Parse this description →'}
      </button>
    </form>
  );
}
