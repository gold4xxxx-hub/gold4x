import { NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// Serves the generated audit index (p2p-audit.json) to the local /audit page.
//
// The index holds every trade party address, every on-chain chat message and
// every payment screenshot CID, so this route refuses to serve it from a
// production build unless the operator opts in explicitly with
// AUDIT_PAGE_ENABLED=1. `next dev` is allowed through with no configuration, so
// the page just works locally.
//
// The index is gitignored and is not part of the build output, so even when
// enabled a deployed host normally has nothing to serve.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED =
  process.env.NODE_ENV !== 'production' || process.env.AUDIT_PAGE_ENABLED === '1';

export async function GET() {
  if (!ALLOWED) {
    return NextResponse.json(
      {
        error:
          'The audit page is disabled in production builds. Set AUDIT_PAGE_ENABLED=1 to serve it.',
      },
      { status: 403 },
    );
  }

  const file = path.join(process.cwd(), 'p2p-audit.json');

  let body: string;
  let generatedAtMs: number;
  try {
    generatedAtMs = fs.statSync(file).mtimeMs;
    body = fs.readFileSync(file, 'utf8');
  } catch {
    return NextResponse.json(
      {
        error:
          'No audit index found. Generate it first:  npm run audit:build',
        missing: true,
      },
      { status: 404 },
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Age lets the page tell the operator how stale the data is, which
      // matters when the chain is moving faster than the index is rebuilt.
      'x-index-generated-ms': String(generatedAtMs),
      'cache-control': 'no-store',
    },
  });
}
