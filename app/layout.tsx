import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Hiring Assistant',
  description: 'Source candidates from a job description and screen them with Hunar Voice AI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="mx-auto max-w-5xl px-6 py-10">
          <header className="mb-10 flex items-baseline justify-between border-b border-line pb-5">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              AI Hiring Assistant
            </Link>
            <span className="text-xs text-muted">Sourcing + voice screening via Hunar</span>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
