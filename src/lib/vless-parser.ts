import { logger } from '@lib/logger';
import type { VlessEntry } from '@types';

/** Parse a single vless:// URL string into a VlessEntry, returns null on failure */
function parseOne(raw: string): VlessEntry | null {
  try {
    const url = new URL(raw);
    const p = url.searchParams;

    return {
      uuid: url.username,
      address: url.hostname,
      port: Number(url.port) || 443,
      type: p.get('type') ?? 'tcp',
      security: p.get('security') ?? 'none',
      flow: p.get('flow') ?? undefined,
      sni: p.get('sni') ?? undefined,
      pbk: p.get('pbk') ?? undefined,
      sid: p.get('sid') ?? undefined,
      fp: p.get('fp') ?? undefined,
      path: p.get('path') ?? undefined,
      host: p.get('host') ?? undefined,
      serviceName: p.get('serviceName') ?? undefined,
      mode: p.get('mode') ?? undefined,
      authority: p.get('authority') ?? undefined,
      name: decodeURIComponent(url.hash.slice(1)),
      raw,
    };
  } catch (err) {
    logger.warn('Failed to parse vless URL', {
      url: raw.slice(0, 80),
      error: String(err),
    });

    return null;
  }
}

/** Parse an array of raw vless:// strings, skipping malformed entries */
export function parseVlessLines(lines: string[]): VlessEntry[] {
  const results: VlessEntry[] = [];
  let failed = 0;

  for (const line of lines) {
    const entry = parseOne(line);
    if (entry) {
      results.push(entry);
    } else {
      failed++;
    }
  }

  logger.info('Parsed vless entries', {
    total: lines.length,
    parsed: results.length,
    failed,
  });

  return results;
}
