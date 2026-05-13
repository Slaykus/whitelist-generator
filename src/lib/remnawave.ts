import type { Env } from '@config/env';
import { logger } from '@lib/logger';
import { RemnawaveSDK } from '@mishkat/remnawave-sdk';
import type { XrayConfig } from '@types';

/** Create and return a RemnawaveSDK instance from validated env */
export function createRemnawaveClient(env: Env): RemnawaveSDK {
  return new RemnawaveSDK({
    panelUrl: env.REMNAWAVE_URL!,
    apiKey: env.REMNAWAVE_API_KEY!,
  });
}

/**
 * Push the generated Xray config to a Remnawave config profile.
 * Requires SYNC_ENABLED=true and related env vars.
 */
export async function syncConfig(config: XrayConfig, env: Env): Promise<void> {
  if (!env.SYNC_ENABLED) {
    logger.warn('Remnawave sync disabled, skipping');
    return;
  }

  const sdk = createRemnawaveClient(env);
  const templateUuid = env.REMNAWAVE_TEMPLATE_UUID!;

  logger.info('Syncing config to Remnawave', {
    url: env.REMNAWAVE_URL,
    templateUuid,
  });

  try {
    await sdk.subscriptionTemplate.updateTemplate({
      uuid: templateUuid,
      templateJson: config as unknown as Record<string, unknown>,
    });

    logger.info('Remnawave sync complete', { templateUuid });
  } catch (err) {
    logger.error('Remnawave sync failed', { templateUuid, error: String(err) });
    throw err;
  }
}
