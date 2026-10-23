'use client';

import { useEffect, useRef, useState } from 'react';

type Phase = 'idle' | 'connecting' | 'live' | 'ended' | 'error';

export function Interview({
  candidateId,
  publicKey,
  assistantId,
  variables,
}: {
  candidateId: string;
  publicKey: string;
  assistantId: string;
  variables: Record<string, string>;
}) {
  const vapiRef = useRef<{ stop(): void } | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hang up if the candidate navigates away mid-call.
  useEffect(() => () => vapiRef.current?.stop(), []);

  async function start() {
    setPhase('connecting');
    setError(null);
    try {
      // Imported on click, not at module load: the SDK touches browser-only
      // globals and would break server rendering.
      const { default: Vapi } = await import('@vapi-ai/web');
      const vapi = new Vapi(publicKey);
      vapiRef.current = vapi;

      vapi.on('speech-start', () => setSpeaking(true));
      vapi.on('speech-end', () => setSpeaking(false));
      vapi.on('call-end', () => setPhase((p) => (p === 'error' ? p : 'ended')));
      vapi.on('error', (e: unknown) => {
        console.error('Vapi error', e);
        setError('The call dropped. Refresh the page to try again.');
        setPhase('error');
      });

      const call = await vapi.start(assistantId, { variableValues: variables });
      if (!call?.id) throw new Error('The voice service did not return a call id.');
      setPhase('live');

      // Register the call so it shows on the recruiter's dashboard.
      const res = await fetch(`/api/interview/${candidateId}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId: call.id }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Could not register the call.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the call.');
      setPhase('error');
      vapiRef.current?.stop();
    }
  }

  const BTN =
    'border-2 border-ink px-5 py-3 font-display text-base font-extrabold tracking-tight transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div className="space-y-4">
      {phase === 'idle' || phase === 'error' ? (
        <button onClick={start} className={`${BTN} bg-dial text-white`}>
          Start the call
        </button>
      ) : phase === 'connecting' ? (
        <button disabled className={`${BTN} bg-edge`}>
          Connecting…
        </button>
      ) : phase === 'live' ? (
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-2 font-mono text-[12px] tracking-widest text-ring uppercase">
            <span className="is-live size-2.5 rounded-full bg-ring" aria-hidden />
            {speaking ? 'assistant speaking' : 'listening'}
          </span>
          <button onClick={() => vapiRef.current?.stop()} className={`${BTN} bg-card`}>
            End call
          </button>
        </div>
      ) : (
        <p className="border-2 border-live px-4 py-3 font-semibold text-live">
          Thank you, the call is complete. The recruiter will be in touch.
        </p>
      )}

      {error && (
        <p role="alert" className="border-2 border-dead px-3.5 py-2.5 text-sm text-dead">
          {error}
        </p>
      )}
    </div>
  );
}
