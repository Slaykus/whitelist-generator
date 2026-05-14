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
  syncConfig,
} from '@lib';
import type { XrayConfig } from '@types';
import { Cron } from 'croner';

/** Fetch, parse, filter, generate and optionally sync the Xray config */
async function run(): Promise<void> {
  logger.info('Starting vless list processor', {
    disallowedTypes: DISALLOWED_TYPES.join(','),
    remnawaveSync: env.SYNC_ENABLED,
  });

  const rawLines = await fetchVlessList();
  const entries = parseVlessLines(rawLines);
  const filtered = filterByType(entries, DISALLOWED_TYPES);
  const matched = matchAllHosts(filtered, subnetGroups);
  const results = filterByKnownSubnet(matched);

  logger.info('Processing complete', { finalCount: results.length });

  const groupOrder = subnetGroups.map(g => g.balancerTag);
  const outbounds = generateOutbounds(results, groupOrder);

  logger.info('Outbounds generated', { count: outbounds.length });

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
