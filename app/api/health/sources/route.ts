const CHECKS = [
  {
    name: 'ARMOR GitHub data/FAR',
    url: 'https://api.github.com/repos/kidkenpo-create/ARMOR-plus/contents/data/far?ref=main',
  },
  {
    name: 'ARMOR GitHub data/DFARS',
    url: 'https://api.github.com/repos/kidkenpo-create/ARMOR-plus/contents/data/dfars?ref=main',
  },
  {
    name: 'ARMOR GitHub DFARS RFO Part 237',
    url: 'https://raw.githubusercontent.com/kidkenpo-create/ARMOR-plus/main/DFARS-RFO-PART-237-Attachment-1.txt',
  },
];

export const runtime = 'nodejs';

export async function GET() {
  const started = Date.now();
  const results = await Promise.all(CHECKS.map(checkSource));
  const ok = results.every(result => result.ok);

  return Response.json({
    ok,
    checkedAt: new Date().toISOString(),
    elapsedMs: Date.now() - started,
    results,
  }, { status: ok ? 200 : 503 });
}

async function checkSource(source: { name: string; url: string }) {
  const started = Date.now();
  try {
    const response = await fetch(source.url, {
      headers: { 'User-Agent': 'ARMOR-Plus/1.0 Source-Health-Check' },
      cache: 'no-store',
    });
    const text = await response.text();
    return {
      name: source.name,
      url: source.url,
      ok: response.ok,
      status: response.status,
      elapsedMs: Date.now() - started,
      bytes: text.length,
    };
  } catch (error) {
    return {
      name: source.name,
      url: source.url,
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
