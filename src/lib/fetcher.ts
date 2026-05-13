import { VLESS_LIST_URL } from '@config/constants';
import { logger } from '@lib/logger';
import ky from 'ky';

/** Fetch the raw vless list text from the remote source */
export async function fetchVlessList(url = VLESS_LIST_URL): Promise<string[]> {
  logger.info('Fetching vless list', { url });

  const text = await ky.get(url).text();
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('vless://'));

  logger.info('Fetched vless list', { url, count: lines.length });
  return lines;
}
