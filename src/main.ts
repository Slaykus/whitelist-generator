import { DEFAULT_SOURCE_URLS, DISALLOWED_TYPES, env, subnetGroups, XRAY_BASE_CONFIG } from '@config';
import {
  fetchVlessList,
  filterByKnownSubnet,
  filterByType,
  filterUniversal,
  generateMultiConfig,
  generateOutbounds,
  loadSelected,
  logger,
  matchAllHosts,
  parseVlessLines,
  rankResults,
  saveSelected,
  syncConfig,
  testOutbounds,
  toMbps,
} from '@lib';
import type {
  SelectedServer,
  SpeedTestResult,
  XrayConfig,
  XrayVlessOutbound,
} from '@types';
import { Cron } from 'croner';

/** In-place Fisher-Yates shuffle (returns a new array) so TEST_LIMIT samples
 * a different random subset of the pool each run instead of always the first N. */
function shuffle<T>(arr: readonly T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Build the client config from a set of outbounds, write artifacts, sync */
async function buildAndSync(outbounds: XrayVlessOutbound[]): Promise<void> {
  const config: XrayConfig = {
    ...XRAY_BASE_CONFIG,
    outbounds: [
      ...XRAY_BASE_CONFIG.outbounds,
      ...(outbounds as unknown as Record<string, unknown>[]),
    ],
  };

  await Bun.write('xray-client.json', JSON.stringify(config, null, '\t'));
  await Bun.write(
    'xray-multi.json',
    JSON.stringify(generateMultiConfig(outbounds), null, '\t')
  );
  logger.info('Config artifacts written', {
    outbounds: outbounds.length,
    files: 'xray-client.json, xray-multi.json',
  });

  await syncConfig(config, env);
}

/** Fetch the public list and build the full candidate outbound set */
async function collectCandidates(): Promise<XrayVlessOutbound[]> {
  const sources = env.SOURCE_URLS
    ? env.SOURCE_URLS.split(',').map(u => u.trim()).filter(Boolean)
    : DEFAULT_SOURCE_URLS;
  const rawLines = await fetchVlessList(sources);
  const entries = parseVlessLines(rawLines);
  const filtered = filterByType(entries, DISALLOWED_TYPES);
  const matched = matchAllHosts(filtered, subnetGroups);
  const results = filterByKnownSubnet(matched);
  logger.info('Processing complete', { finalCount: results.length });

  const groupOrder = subnetGroups.map(g => g.balancerTag);
  const outbounds = generateOutbounds(results, groupOrder);
  logger.info('Outbounds generated', { count: outbounds.length });
  return outbounds;
}

/** Synthetic "passed" result for the no-test / fallback paths */
function passthroughResult(o: XrayVlessOutbound): SpeedTestResult {
  return {
    tag: o.tag,
    address: o.settings.vnext[0].address,
    port: o.settings.vnext[0].port,
    available: true,
    latencyMs: -1,
    speedBytesPerSec: 0,
    downloadedBytes: 0,
  };
}

/**
 * FULL pass: fetch, (speed-)test every candidate, rank, keep the fastest
 * TEST_TOP_N, persist the selection and sync. This is the heavy job.
 */
async function runFull(): Promise<void> {
  logger.info('Full run started', {
    remnawaveSync: env.SYNC_ENABLED,
    speedTest: env.TEST_ENABLED,
  });

  const candidates = await collectCandidates();
  let selected: SelectedServer[];

  if (env.TEST_ENABLED) {
    const pool =
      env.TEST_LIMIT > 0 ? shuffle(candidates).slice(0, env.TEST_LIMIT) : candidates;

    logger.info('Speed testing candidates', {
      count: pool.length,
      topN: env.TEST_TOP_N,
      concurrency: env.TEST_CONCURRENCY,
    });

    const results = await testOutbounds(pool, {
      concurrency: env.TEST_CONCURRENCY,
      basePort: env.TEST_BASE_PORT,
      latencyUrl: env.TEST_LATENCY_URL,
      downloadUrl: env.TEST_DOWNLOAD_URL,
      timeoutMs: env.TEST_TIMEOUT_MS,
      measureSpeed: true,
    });

    const sorted = [...results].sort(
      (a, b) => b.speedBytesPerSec - a.speedBytesPerSec
    );
    await Bun.write(
      env.TEST_RESULTS_PATH,
      JSON.stringify(
        {
          testedAt: new Date().toISOString(),
          total: results.length,
          available: results.filter(r => r.available).length,
          results: sorted,
        },
        null,
        '\t'
      )
    );

    // Over-sample the fast pool so the universality filter still leaves TEST_TOP_N.
    const oversample = env.BSBORD_ENABLED
      ? env.TEST_TOP_N * env.BSBORD_OVERSAMPLE
      : env.TEST_TOP_N;
    const ranked = rankResults(results, {
      topN: oversample,
      minSpeedMbps: env.TEST_MIN_SPEED_MBPS,
      maxLatencyMs: env.TEST_MAX_LATENCY_MS,
    });

    logger.info('Speed test complete', {
      tested: results.length,
      available: results.filter(r => r.available).length,
      fastPool: ranked.length,
      fastestMbps: sorted[0]
        ? Number(toMbps(sorted[0].speedBytesPerSec).toFixed(1))
        : 0,
    });

    const byTag = new Map(candidates.map(o => [o.tag, o]));
    let fastPool: SelectedServer[] = ranked
      .map(r => {
        const outbound = byTag.get(r.tag);
        return outbound ? { result: r, outbound } : null;
      })
      .filter((s): s is SelectedServer => s !== null);

    // Keep only servers that work across all live Russian operators (bsbord).
    if (env.BSBORD_ENABLED && env.BSBORD_API_KEY) {
      fastPool = await filterUniversal(fastPool, {
        apiUrl: env.BSBORD_API_URL,
        apiKey: env.BSBORD_API_KEY,
        dpi: env.BSBORD_DPI,
        minOperators: env.BSBORD_MIN_OPERATORS,
        cacheTtlMs: env.BSBORD_CACHE_TTL_HOURS * 3_600_000,
        cachePath: env.BSBORD_CACHE_PATH,
        perOperator: env.BSBORD_MIN_PER_OP,
        maxTotal: env.TEST_TOP_N,
      });
    }

    selected = fastPool.slice(0, env.TEST_TOP_N);
  } else {
    selected = candidates.map(o => ({ result: passthroughResult(o), outbound: o }));
  }

  // Never push raw/unverified candidates. If nothing passed, keep whatever is
  // already live (the previous good selection) instead of shipping dead servers.
  if (selected.length === 0) {
    logger.warn('No working servers this run — keeping the previous selection (no sync)');
    return;
  }

  await saveSelected(env.SELECTED_STATE_PATH, selected);
  await buildAndSync(selected.map(s => s.outbound));
  logger.info('Full run finished', { selected: selected.length });
}

/**
 * LIGHT pass: re-check only the currently selected servers for availability
 * and latency (no throughput download), drop the dead ones, re-sync. Cheap
 * enough to run frequently. Falls back to a full run if there is no state.
 */
async function runLight(): Promise<void> {
  const prev = await loadSelected(env.SELECTED_STATE_PATH);
  if (!prev || prev.length === 0) {
    logger.info('No saved selection — running full pass instead');
    return runFull();
  }

  logger.info('Light re-check started', { servers: prev.length });

  const results = await testOutbounds(
    prev.map(s => s.outbound),
    {
      concurrency: env.TEST_CONCURRENCY,
      basePort: env.TEST_BASE_PORT,
      latencyUrl: env.TEST_LATENCY_URL,
      downloadUrl: env.TEST_DOWNLOAD_URL,
      timeoutMs: env.TEST_TIMEOUT_MS,
      measureSpeed: false,
    }
  );
  const status = new Map(results.map(r => [r.tag, r]));

  const survivors = prev
    .filter(s => status.get(s.outbound.tag)?.available)
    .map(s => ({
      outbound: s.outbound,
      result: {
        ...s.result,
        available: true,
        latencyMs: status.get(s.outbound.tag)?.latencyMs ?? s.result.latencyMs,
      },
    }));

  if (survivors.length === 0) {
    logger.warn('All selected servers are down — keeping previous selection');
    return;
  }

  logger.info('Light re-check complete', {
    kept: survivors.length,
    dropped: prev.length - survivors.length,
  });

  await saveSelected(env.SELECTED_STATE_PATH, survivors);
  await buildAndSync(survivors.map(s => s.outbound));
}

/** Run a full pass at startup, then schedule light + full jobs when syncing */
async function main(): Promise<void> {
  await runFull();

  if (!env.SYNC_ENABLED) {
    logger.info('Remnawave sync disabled — scheduler not started');
    return;
  }

  new Cron(env.SCHEDULE_CRON, { name: 'light-check', catch: false }, async () => {
    try {
      await runLight();
    } catch (err) {
      logger.error('Scheduled light re-check failed', { error: String(err) });
    }
  });

  new Cron(env.FULL_TEST_CRON, { name: 'full-test', catch: false }, async () => {
    try {
      await runFull();
    } catch (err) {
      logger.error('Scheduled full test failed', { error: String(err) });
    }
  });

  logger.info('Scheduler started', {
    lightCheck: env.SCHEDULE_CRON,
    fullTest: env.FULL_TEST_CRON,
  });
}

void main().catch((err: unknown) => {
  logger.error('Fatal error', { error: String(err) });
  process.exit(1);
});
