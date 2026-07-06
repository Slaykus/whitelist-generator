import { DISALLOWED_TYPES, env, subnetGroups, XRAY_BASE_CONFIG } from '@config';
import {
  fetchVlessList,
  filterByKnownSubnet,
  filterByType,
  generateMultiConfig,
  generateOutbounds,
  logger,
  matchAllHosts,
  parseVlessLines,
  rankResults,
  syncConfig,
  testOutbounds,
  toMbps,
} from '@lib';
import type { SpeedTestResult, XrayConfig, XrayVlessOutbound } from '@types';
import { Cron } from 'croner';

/** Full report written to disk after a test pass */
interface TestReport {
  testedAt: string;
  total: number;
  available: number;
  selected: number;
  results: SpeedTestResult[];
}

/**
 * Speed-test the candidate outbounds, persist a ranked report, and return
 * only the fastest ones (per TEST_TOP_N). Falls back to all candidates on
 * a total failure so a bad test run never empties the config silently.
 */
async function selectFastest(
  outbounds: XrayVlessOutbound[]
): Promise<XrayVlessOutbound[]> {
  const candidates =
    env.TEST_LIMIT > 0 ? outbounds.slice(0, env.TEST_LIMIT) : outbounds;

  logger.info('Speed testing candidates', {
    count: candidates.length,
    topN: env.TEST_TOP_N,
    concurrency: env.TEST_CONCURRENCY,
  });

  const results = await testOutbounds(candidates, {
    concurrency: env.TEST_CONCURRENCY,
    basePort: env.TEST_BASE_PORT,
    latencyUrl: env.TEST_LATENCY_URL,
    downloadUrl: env.TEST_DOWNLOAD_URL,
    timeoutMs: env.TEST_TIMEOUT_MS,
  });

  const ranked = rankResults(results, {
    topN: env.TEST_TOP_N,
    minSpeedMbps: env.TEST_MIN_SPEED_MBPS,
    maxLatencyMs: env.TEST_MAX_LATENCY_MS,
  });

  const sorted = [...results].sort(
    (a, b) => b.speedBytesPerSec - a.speedBytesPerSec
  );
  const report: TestReport = {
    testedAt: new Date().toISOString(),
    total: results.length,
    available: results.filter(r => r.available).length,
    selected: ranked.length,
    results: sorted,
  };
  await Bun.write(env.TEST_RESULTS_PATH, JSON.stringify(report, null, '\t'));

  logger.info('Speed test complete', {
    tested: report.total,
    available: report.available,
    selected: report.selected,
    fastestMbps: sorted[0]
      ? Number(toMbps(sorted[0].speedBytesPerSec).toFixed(1))
      : 0,
    resultsPath: env.TEST_RESULTS_PATH,
  });

  if (ranked.length === 0) {
    logger.warn('No servers passed testing — keeping all candidates');
    return candidates;
  }

  const keep = new Set(ranked.map(r => r.tag));
  return candidates.filter(o => keep.has(o.tag));
}

/** Fetch, parse, filter, (optionally test), generate and optionally sync */
async function run(): Promise<void> {
  logger.info('Starting vless list processor', {
    disallowedTypes: DISALLOWED_TYPES.join(','),
    remnawaveSync: env.SYNC_ENABLED,
    speedTest: env.TEST_ENABLED,
  });

  const rawLines = await fetchVlessList();
  const entries = parseVlessLines(rawLines);
  const filtered = filterByType(entries, DISALLOWED_TYPES);
  const matched = matchAllHosts(filtered, subnetGroups);
  const results = filterByKnownSubnet(matched);

  logger.info('Processing complete', { finalCount: results.length });

  const groupOrder = subnetGroups.map(g => g.balancerTag);
  let outbounds = generateOutbounds(results, groupOrder);

  logger.info('Outbounds generated', { count: outbounds.length });

  if (env.TEST_ENABLED) {
    outbounds = await selectFastest(outbounds);
    logger.info('Kept fastest outbounds', { count: outbounds.length });
  }

  const config: XrayConfig = {
    ...XRAY_BASE_CONFIG,
    outbounds: [
      ...XRAY_BASE_CONFIG.outbounds,
      ...(outbounds as unknown as Record<string, unknown>[]),
    ],
  };

  const outputPath = 'xray-client.json';
  await Bun.write(outputPath, JSON.stringify(config, null, '\t'));
  logger.info('Config saved', { path: outputPath });

  const multiPath = 'xray-multi.json';
  await Bun.write(
    multiPath,
    JSON.stringify(generateMultiConfig(outbounds), null, '\t')
  );
  logger.info('Multi-config saved', { path: multiPath });

  await syncConfig(config, env);
}

/** Run immediately on startup, then schedule every hour at :00 */
async function main(): Promise<void> {
  await run();

  if (!env.SYNC_ENABLED) {
    logger.info('Remnawave sync disabled — scheduler not started');
    return;
  }

  new Cron('@hourly', { name: 'vless-sync', catch: false }, async () => {
    try {
      await run();
    } catch (err) {
      logger.error('Scheduled run failed', { error: String(err) });
    }
  });

  logger.info('Scheduler started', { schedule: '@hourly' });
}

void main().catch((err: unknown) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
