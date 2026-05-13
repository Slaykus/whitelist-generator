import { logger } from '@lib/logger';
import type { MatchResult, VlessEntry } from '@types';
import type { DISALLOWED_TYPES } from '@/config/constants';

/** Filter out entries whose transport type is in the disallowed list (e.g. ["xhttp"]) */
export function filterByType(
  entries: VlessEntry[],
  disallowedTypes: typeof DISALLOWED_TYPES
): VlessEntry[] {
  const blocked = new Set(disallowedTypes.map(t => t.toLowerCase()));
  const passed = entries.filter(e => !blocked.has(e.type.toLowerCase()));

  logger.info('Filtered by transport type', {
    disallowed: disallowedTypes.join(','),
    passed: passed.length,
    skipped: entries.length - passed.length,
  });

  return passed;
}

/** Keep only entries whose IP matched a known subnet group */
export function filterByKnownSubnet(results: MatchResult[]): MatchResult[] {
  const passed = results.filter(r => r.hoster !== null);

  logger.info('Filtered by known subnet', {
    passed: passed.length,
    skipped: results.length - passed.length,
  });

  return passed;
}
