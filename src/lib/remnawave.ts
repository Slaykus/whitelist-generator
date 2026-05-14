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
 * Fetch the remote template, replace its outbounds with the generated ones,
 * and return the merged config.
 */
async function mergeOutboundsIntoRemoteTemplate(
  sdk: RemnawaveSDK,
  templateUuid: string,
  newOutbounds: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const template = await sdk.subscriptionTemplate.getTemplate(templateUuid);
  const remote = (template?.templateJson ?? {}) as Record<string, unknown>;

  logger.info('Fetched remote template for merge', { templateUuid });

  return { ...remote, outbounds: newOutbounds };
}

/**
 * Push the generated Xray config to a Remnawave subscription template.
 * - OVERWRITE_FULL_CONFIG=true  → replace the whole template JSON
 * - OVERWRITE_FULL_CONFIG=false → fetch remote template, replace outbounds only
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
    mode: env.OVERWRITE_FULL_CONFIG ? 'overwrite' : 'merge',
  });

  try {
    let payload: Record<string, unknown>;

    if (env.OVERWRITE_FULL_CONFIG) {
      payload = config as unknown as Record<string, unknown>;
    } else {
      const newOutbounds = config.outbounds as Record<string, unknown>[];
      payload = await mergeOutboundsIntoRemoteTemplate(
        sdk,
        templateUuid,
        newOutbounds
      );
    }

    await sdk.subscriptionTemplate.updateTemplate({
      uuid: templateUuid,
      templateJson: payload,
    });

    logger.info('Remnawave sync complete', { templateUuid });
  } catch (err) {
    logger.error('Remnawave sync failed', { templateUuid, error: String(err) });
    throw err;
  }
}
