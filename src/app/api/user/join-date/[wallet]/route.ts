import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const CACHE_TTL = 5 * 60 * 1000;
const cache = new Map<string, { date: string | null; ts: number }>();
const CONTRACT = '0x418b7e6bbc48ca93126c22a1e83b6420a4e0c6fd';

function decodeHtmlEntities(str: string): string {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'");
}

async function fetchBscScan(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function extractTransactions(html: string): any[] | null {
  // Try multiple BscScan export variable patterns
  const patterns = [
    /MTCS_REPORT_DATA\s*=\s*(\[.*?\])\s*;/,
    /quickExportTransactionListData\s*=\s*'(\[.*?\])'\s*;/,
    /listLoaded\s*\(\s*'[^']*'\s*,\s*(\[.*?\])\s*,\s*'/,
    /dataTable\.rows\s*=\s*(\[.*?\])\s*;/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (!m) continue;
    try {
      const raw = m[1].replace(/\\'/g, "'").replace(/\\"/g, '"');
      const decoded = decodeHtmlEntities(raw);
      const data = JSON.parse(decoded);
      if (Array.isArray(data) && data.length > 0) return data;
    } catch { /* try next pattern */ }
  }
  return null;
}

function extractTableRows(html: string): any[] | null {
  const rows: any[] = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return null;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tbodyMatch[1])) !== null) {
    const cells: string[] = [];
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      cells.push(cellMatch[1].replace(/<[^>]*>/g, '').trim());
    }
    if (cells.length >= 6) {
      const dateTime = cells[2] || '';
      const method = cells[5] ? cells[5].replace(/<[^>]*>/g, '').trim() : '';
      rows.push({ DateTime: dateTime, Method: method });
    }
  }
  return rows.length > 0 ? rows : null;
}

function parseCsvDate(raw: string): string | null {
  // BscScan CSV date format: "2024-01-15 10:30:00" or similar
  const d = new Date(raw.replace(' UTC', '').trim());
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function extractOldestFromHtml(html: string): string | null {
  // Try JS variable patterns first
  let txs = extractTransactions(html);
  if (!txs || txs.length === 0) {
    txs = extractTableRows(html);
  }
  if (!txs || txs.length === 0) return null;

  const knownPrefixes = ['register', 'invest', 'transfer'];
  let oldest: string | null = null;
  for (const tx of txs) {
    const method = (tx.Method || '').toLowerCase().replace(/\s+/g, '');
    if (!knownPrefixes.some(k => method.includes(k) || method.startsWith(k))) continue;
    const dt = tx.DateTime;
    if (dt && (!oldest || dt < oldest)) oldest = dt;
  }
  return oldest;
}

async function tryFetchTokenTxs(wallet: string): Promise<string | null> {
  // Token transfers to the contract (e.g. USDT/USDC deposits)
  const tokenUrl = `https://bscscan.com/token-txns?a=${wallet}&to=${CONTRACT}&ps=100`;
  const html = await fetchBscScan(tokenUrl);
  if (!html) return null;
  return extractOldestFromHtml(html);
}

async function tryFetchCsv(wallet: string): Promise<string | null> {
  // BscScan CSV export (up to 5000 rows)
  const csvUrl = `https://bscscan.com/txns.csv?a=${wallet}`;
  try {
    const csv = await fetchBscScan(csvUrl);
    if (!csv) return null;
    const lines = csv.trim().split('\n');
    if (lines.length < 2) return null;
    const headers = lines[0].split(',');
    const toIdx = headers.indexOf('To');
    const hashIdx = headers.indexOf('TxHash');
    const dateIdx = headers.findIndex(h => /date/i.test(h));
    if (toIdx === -1 || dateIdx === -1) return null;
    const oldestRaw = lines.slice(1).reduce((oldest: string | null, line: string) => {
      const cols = line.split(',');
      const to = (cols[toIdx] || '').replace(/"/g, '').toLowerCase();
      if (to !== CONTRACT) return oldest;
      const raw = cols[dateIdx];
      if (!raw) return oldest;
      const iso = parseCsvDate(raw);
      if (!iso) return oldest;
      return (!oldest || iso < oldest) ? iso : oldest;
    }, null);
        return oldestRaw ? oldestRaw : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ wallet: string }> },
) {
  const { wallet: rawWallet } = await context.params;
  const wallet = rawWallet.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
  }

  const now = Date.now();
  const cached = cache.get(wallet);
  if (cached && now - cached.ts < CACHE_TTL) {
    return NextResponse.json({ date: cached.date });
  }

  const baseUrl = `https://bscscan.com/txs?a=${wallet}&to=${CONTRACT}&ps=100`;

  const page1 = await fetchBscScan(baseUrl);
  if (!page1) {
    // Fallback to CSV if HTML fetch fails
    const csvDate = await tryFetchCsv(wallet);
    cache.set(wallet, { date: csvDate, ts: now });
    return NextResponse.json({ date: csvDate });
  }

  const pageMatch = page1.match(/Page \d+ of (\d+)/i);
  const totalPages = pageMatch ? parseInt(pageMatch[1], 10) : 1;

  const lastHtml = totalPages > 1
    ? (await fetchBscScan(`${baseUrl}&p=${totalPages}`)) ?? page1
    : page1;

  let oldest = extractOldestFromHtml(lastHtml);

  // If no tx found on txs page, try token-txns page (stablecoin deposits)
  if (!oldest) {
    oldest = await tryFetchTokenTxs(wallet);
  }

  // Last resort: try CSV export
  if (!oldest) {
    oldest = await tryFetchCsv(wallet);
  }

  cache.set(wallet, { date: oldest, ts: now });
  return NextResponse.json({ date: oldest });
}
