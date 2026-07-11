import { logger } from '@lib/logger';
import type { SelectedServer, XrayVlessOutbound } from '@types';

export interface BsbordOptions {
  apiUrl: string;
  apiKey: string;
  /** 'on' = only DPI-active operators (real BS); 'any' = include non-BS */
  dpi: string;
  /** Skip filtering if fewer than this many operators are alive (avoid starving the pool) */
  minOperators: number;
  cacheTtlMs: number;
  cachePath: string;
  /** Target number of servers covering each live operator */
  perOperator: number;
  /** Hard cap on the final selection */
  maxTotal: number;
}

interface Verdict {
  okOperators: string[];
  checkedAt: string;
}
interface CacheFile {
  verdicts: Record<string, Verdict>;
}

// API throttle is 1 req/sec (min_interval_sec: 1.0) — add margin.
const THROTTLE_MS = 1200;
const BATCH = 10;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

function endpoint(o: XrayVlessOutbound): string {
  const v = o.settings.vnext[0];
  return `${v.address}:${v.port}`;
}

function sniOf(o: XrayVlessOutbound): string | undefined {
  const ss = o.streamSettings;
  return ss.realitySettings?.serverName ?? ss.tlsSettings?.serverName ?? undefined;
}

async function loadCache(path: string): Promise<CacheFile> {
  const f = Bun.file(path);
  if (await f.exists()) {
    try {
      const d = (await f.json()) as Partial<CacheFile>;
      if (d.verdicts) return { verdicts: d.verdicts };
    } catch {
      /* fall through to empty */
    }
  }
  return { verdicts: {} };
}

async function aliveOperators(opts: BsbordOptions): Promise<string[]> {
  const resp = await fetch(`${opts.apiUrl}/operators`, {
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });
  if (!resp.ok) throw new Error(`operators HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    operators?: Array<{ op_key: string; alive: boolean; channel_state?: string }>;
  };
  return (data.operators ?? [])
    .filter(o => o.alive && (opts.dpi === 'any' || o.channel_state === 'DPI_ON'))
    .map(o => o.op_key);
}

/** Probe up to 10 servers across operators; returns endpoint -> list of ok op_keys. */
async function probeBatch(
  batch: XrayVlessOutbound[],
  opts: BsbordOptions
): Promise<Record<string, string[]>> {
  const sniHosts = [...new Set(batch.map(sniOf).filter((s): s is string => !!s))];
  const body = {
    targets: batch.map(endpoint),
    probes: { icmp: false, tcp: true, sni: sniHosts.length > 0 },
    sni_hosts: sniHosts,
    dpi: opts.dpi,
  };
  const resp = await fetch(`${opts.apiUrl}/probe`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`probe HTTP ${resp.status}`);
  const data = (await resp.json()) as {
    by_target?: Record<string, { by_operator?: Record<string, { ok?: boolean }> }>;
  };
  const out: Record<string, string[]> = {};
  for (const [tgt, td] of Object.entries(data.by_target ?? {})) {
    out[tgt] = Object.entries(td.by_operator ?? {})
      .filter(([, info]) => info.ok === true)
      .map(([op]) => op);
  }
  return out;
}

/**
 * Select servers for OPERATOR COVERAGE (tested through real Russian operator
 * modems). Instead of demanding every server be universal (rare on public
 * pools), we ensure each live operator is covered by several servers, mixing
 * fully- and partially-working nodes, then fill up to maxTotal by speed.
 * Verdicts are cached per endpoint. Fail-open on API trouble or too few live
 * operators (returns the fastest servers unchanged — never empties the pool).
 */
export async function filterUniversal(
  servers: SelectedServer[],
  opts: BsbordOptions
): Promise<SelectedServer[]> {
  if (servers.length === 0) return servers;

  let alive: string[];
  try {
    alive = await aliveOperators(opts);
  } catch (e) {
    logger.warn('bsbord: operators fetch failed — skipping filter', { error: String(e) });
    return servers.slice(0, opts.maxTotal);
  }
  if (alive.length < opts.minOperators) {
    logger.warn('bsbord: too few live operators — skipping filter', {
      alive: alive.length,
      need: opts.minOperators,
    });
    return servers.slice(0, opts.maxTotal);
  }
  logger.info('bsbord: coverage selection', {
    candidates: servers.length,
    liveOperators: alive.join(','),
    perOperator: opts.perOperator,
    maxTotal: opts.maxTotal,
  });

  const cache = await loadCache(opts.cachePath);
  const now = Date.now();
  const isFresh = (v?: Verdict): boolean =>
    !!v && Array.isArray(v.okOperators) && now - new Date(v.checkedAt).getTime() < opts.cacheTtlMs;

  const toProbe = servers.filter(s => !isFresh(cache.verdicts[endpoint(s.outbound)]));
  logger.info('bsbord: cache state', {
    cached: servers.length - toProbe.length,
    toProbe: toProbe.length,
  });

  for (let i = 0; i < toProbe.length; i += BATCH) {
    const batch = toProbe.slice(i, i + BATCH).map(s => s.outbound);
    let res: Record<string, string[]>;
    try {
      res = await probeBatch(batch, opts);
    } catch (e) {
      logger.error('bsbord: probe batch failed', { error: String(e) });
      continue;
    }
    for (const o of batch) {
      cache.verdicts[endpoint(o)] = {
        okOperators: res[endpoint(o)] ?? [],
        checkedAt: new Date().toISOString(),
      };
    }
    await Bun.write(opts.cachePath, JSON.stringify(cache, null, '\t'));
    if (i + BATCH < toProbe.length) await sleep(THROTTLE_MS);
  }

  const okOps = (s: SelectedServer): string[] =>
    cache.verdicts[endpoint(s.outbound)]?.okOperators ?? [];
  // Eligible = alive on at least one real operator; `servers` is already speed-sorted.
  const eligible = servers.filter(s => okOps(s).some(op => alive.includes(op)));

  const selected: SelectedServer[] = [];
  const chosen = new Set<string>();
  // 1) Cover each operator with up to perOperator fastest servers.
  for (const op of alive) {
    let have = 0;
    for (const s of eligible) {
      if (have >= opts.perOperator) break;
      const ep = endpoint(s.outbound);
      if (chosen.has(ep)) {
        if (okOps(s).includes(op)) have += 1;
        continue;
      }
      if (okOps(s).includes(op)) {
        selected.push(s);
        chosen.add(ep);
        have += 1;
      }
    }
  }
  // 2) Fill remaining slots with the fastest eligible servers.
  for (const s of eligible) {
    if (selected.length >= opts.maxTotal) break;
    const ep = endpoint(s.outbound);
    if (!chosen.has(ep)) {
      selected.push(s);
      chosen.add(ep);
    }
  }

  const coverage = alive
    .map(op => `${op}:${selected.filter(s => okOps(s).includes(op)).length}`)
    .join(' ');
  logger.info('bsbord: selection complete', {
    selected: selected.length,
    eligible: eligible.length,
    coverage,
  });
  return selected.slice(0, opts.maxTotal);
}
