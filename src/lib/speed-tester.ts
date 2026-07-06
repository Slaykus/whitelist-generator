import { logger } from '@lib/logger';
import { toMbps } from '@lib/ranker';
import { startXray } from '@lib/xray-runner';
import type { SpeedTestResult, XrayVlessOutbound } from '@types';

export interface TesterOptions {
  /** Number of servers tested in parallel */
  concurrency: number;
  /** First local SOCKS port; each candidate gets basePort + index */
  basePort: number;
  /** URL used to check availability + latency (expects small/204 response) */
  latencyUrl: string;
  /** URL used to measure download throughput */
  downloadUrl: string;
  /** Per-request timeout in ms */
  timeoutMs: number;
}

interface CurlResult {
  ok: boolean;
  out: string;
}

/** Run curl through a SOCKS proxy and return trimmed stdout */
async function curlThroughProxy(args: string[]): Promise<CurlResult> {
  const proc = Bun.spawn(['curl', ...args], {
    stdout: 'pipe',
    stderr: 'ignore',
  });
  const out = (await new Response(proc.stdout).text()).trim();
  const code = await proc.exited;
  return { ok: code === 0, out };
}

/** Measure availability, latency and download speed for one running instance */
async function measure(
  port: number,
  opts: TesterOptions
): Promise<Partial<SpeedTestResult>> {
  const timeoutSec = Math.max(1, Math.ceil(opts.timeoutMs / 1000));
  const proxy = `socks5h://127.0.0.1:${port}`;

  const lat = await curlThroughProxy([
    '-s', '-o', '/dev/null',
    '-x', proxy,
    '-w', '%{http_code} %{time_starttransfer}',
    '--max-time', String(timeoutSec),
    opts.latencyUrl,
  ]);
  if (!lat.ok) return { available: false };

  const [codeStr, ttfbStr] = lat.out.split(' ');
  const httpCode = Number(codeStr);
  const latencyMs = Math.round(Number(ttfbStr) * 1000);
  if (!(httpCode >= 200 && httpCode < 400)) {
    return { available: false, latencyMs };
  }

  const spd = await curlThroughProxy([
    '-s', '-o', '/dev/null',
    '-x', proxy,
    '-w', '%{speed_download} %{size_download}',
    '--max-time', String(timeoutSec),
    opts.downloadUrl,
  ]);

  let speedBytesPerSec = 0;
  let downloadedBytes = 0;
  if (spd.ok) {
    const [sp, sz] = spd.out.split(' ');
    speedBytesPerSec = Math.round(Number(sp));
    downloadedBytes = Number(sz);
  }

  return { available: true, latencyMs, speedBytesPerSec, downloadedBytes };
}

/**
 * Test every candidate outbound by proxying real traffic through it with
 * xray-core. Runs up to `concurrency` tests at once. Never throws for a
 * single bad server — failures come back as { available: false }.
 */
export async function testOutbounds(
  outbounds: XrayVlessOutbound[],
  opts: TesterOptions
): Promise<SpeedTestResult[]> {
  const results: SpeedTestResult[] = [];
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= outbounds.length) break;

      const ob = outbounds[i];
      if (!ob) continue;
      const vnext = ob.settings.vnext[0];
      const base: SpeedTestResult = {
        tag: ob.tag,
        address: vnext.address,
        port: vnext.port,
        available: false,
        latencyMs: -1,
        speedBytesPerSec: 0,
        downloadedBytes: 0,
      };

      const inst = await startXray(ob, opts.basePort + i);
      if (!inst) {
        logger.warn('xray failed to start', { tag: ob.tag, address: vnext.address });
        results.push(base);
        continue;
      }

      try {
        const m = await measure(inst.port, opts);
        const result = { ...base, ...m };
        results.push(result);
        logger.info('Tested candidate', {
          tag: result.tag,
          address: result.address,
          available: result.available,
          latencyMs: result.latencyMs,
          mbps: Number(toMbps(result.speedBytesPerSec).toFixed(1)),
        });
      } finally {
        inst.stop();
      }
    }
  };

  const pool = Array.from({ length: Math.max(1, opts.concurrency) }, () =>
    worker()
  );
  await Promise.all(pool);
  return results;
}
