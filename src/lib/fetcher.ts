import { DEFAULT_SOURCE_URLS } from '@config/constants';
import { logger } from '@lib/logger';
import ky from 'ky';

/**
 * Fetch vless:// links from one or more sources, concatenate and de-duplicate.
 * A failing source is logged and skipped (never aborts the whole run).
 */
export async function fetchVlessList(
  urls: readonly string[] = DEFAULT_SOURCE_URLS
): Promise<string[]> {
  const seen = new Set<string>();

  for (const url of urls) {
    try {
      logger.info('Fetching vless list', { url });
      const text = await ky.get(url, { timeout: 20_000 }).text();
      let count = 0;
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (t.startsWith('vless://')) {
          seen.add(t);
          count += 1;
        }
      }
      logger.info('Fetched vless list', { url, count });
    } catch (err) {
      logger.warn('Source fetch failed — skipping', { url, error: String(err) });
    }
  }

  const lines = [...seen];
  logger.info('Combined sources', { sources: urls.length, uniqueLinks: lines.length });
  return lines;
}
