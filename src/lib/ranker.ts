import type { SpeedTestResult } from '@types';

export interface RankOptions {
  /** Keep at most this many results (0 = keep all passing) */
  topN: number;
  /** Minimum download speed in Mbps (0 = no floor) */
  minSpeedMbps: number;
  /** Maximum acceptable latency in ms (0 = no cap) */
  maxLatencyMs: number;
}

/** bytes/sec -> Mbps */
export function toMbps(bytesPerSec: number): number {
  return (bytesPerSec * 8) / 1e6;
}

/**
 * Filter out unavailable / too-slow / too-laggy servers, then sort by
 * download speed (fastest first) and keep the top N.
 */
export function rankResults(
  results: SpeedTestResult[],
  opts: RankOptions
): SpeedTestResult[] {
  const passing = results.filter(r => {
    if (!r.available) return false;
    if (!r.bypassOk) return false;
    if (opts.maxLatencyMs > 0 && r.latencyMs > opts.maxLatencyMs) return false;
    if (opts.minSpeedMbps > 0 && toMbps(r.speedBytesPerSec) < opts.minSpeedMbps) {
      return false;
    }
    return true;
  });

  passing.sort((a, b) => b.speedBytesPerSec - a.speedBytesPerSec);
  return opts.topN > 0 ? passing.slice(0, opts.topN) : passing;
}
