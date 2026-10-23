import { NextResponse, type NextRequest } from 'next/server';

/**
 * Password gate for the recruiter side: it launches billable calls and shows
 * phone numbers and recordings. Candidate interview pages, Vapi's webhook and
 * the health check stay public (see `config.matcher`).
 */
export function middleware(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    // Open locally for convenience; never open on a deployment.
    if (process.env.VERCEL) {
      return new NextResponse('Set ADMIN_PASSWORD in the Vercel environment.', { status: 503 });
    }
    return NextResponse.next();
  }

  const [scheme, encoded] = (req.headers.get('authorization') ?? '').split(' ');
  if (scheme === 'Basic' && encoded) {
    try {
      const pass = atob(encoded).split(':').slice(1).join(':');
      if (pass === password) return NextResponse.next();
    } catch {
      // Malformed base64 falls through to the challenge.
    }
  }
  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Hiring Assistant"' },
  });
}

export const config = {
  matcher: ['/((?!interview|api/interview|api/webhooks|api/health|_next|favicon.ico).*)'],
};
