import type { Metadata } from 'next';
import Link from 'next/link';
import { Archivo, Bricolage_Grotesque, JetBrains_Mono } from 'next/font/google';
import './globals.css';

// Self-hosted at build time by next/font — no external request at runtime.
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  weight: ['600', '800'],
});
const archivo = Archivo({ subsets: ['latin'], variable: '--font-archivo' });
const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  weight: ['400', '600'],
});

export const metadata: Metadata = {
  title: 'AI Hiring Assistant',
  description: 'Source candidates from a job description and screen them with Hunar Voice AI.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${archivo.variable} ${jetbrains.variable}`}>
      <body>
        <header className="border-b-2 border-ink bg-card">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
            <Link href="/" className="group flex items-baseline gap-2.5">
              <span className="font-display text-xl font-extrabold tracking-tight">
                Hiring Assistant
              </span>
              <span className="hidden font-mono text-[11px] tracking-widest text-mute uppercase sm:inline">
                switchboard
              </span>
            </Link>
            <span className="font-mono text-[11px] tracking-wider text-mute">
              JD → search → call → answers
            </span>
          </div>
        </header>
        <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">{children}</div>
      </body>
    </html>
  );
}
