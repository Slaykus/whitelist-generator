import { logger } from '@lib/logger';
import type { MatchResult, SubnetGroup, VlessEntry } from '@types';
import { IPv4CidrRange } from 'ip-num';

/** Pre-parsed cache of CIDR ranges per group to avoid re-parsing on every call */
function buildRangeCache(groups: SubnetGroup[]): Map<string, IPv4CidrRange[]> {
  const cache = new Map<string, IPv4CidrRange[]>();
  for (const group of groups) {
    const ranges: IPv4CidrRange[] = [];
    for (const cidr of group.subnets) {
      try {
        ranges.push(IPv4CidrRange.fromCidr(cidr));
      } catch {
        logger.warn('Invalid CIDR, skipping', { group: group.name, cidr });
      }
    }
    cache.set(group.name, ranges);
  }

  return cache;
}

/** Check whether an IPv4 address string falls inside a CIDR range */
function ipInRange(ip: string, range: IPv4CidrRange): boolean {
  try {
    // Wrap the single IP as a /32 and check if it sits inside the subnet
    const host = IPv4CidrRange.fromCidr(`${ip}/32`);
    return host.inside(range);
  } catch {
    return false;
  }
}

/**
 * Match an IP address against a list of subnet groups.
 * Returns the matched group, or null.
 */
function matchGroup(
  ip: string,
  groups: SubnetGroup[],
  cache: Map<string, IPv4CidrRange[]>
): SubnetGroup | null {
  for (const group of groups) {
    const ranges = cache.get(group.name) ?? [];
    if (ranges.some(r => ipInRange(ip, r))) {
      return group;
    }
  }
  return null;
}

/** Match all VlessEntry addresses against subnet groups and return MatchResult[] */
export function matchAllHosts(
  entries: VlessEntry[],
  groups: SubnetGroup[]
): MatchResult[] {
  const cache = buildRangeCache(groups);

  const results = entries.map(entry => {
    const group = matchGroup(entry.address, groups, cache);
    return {
      entry,
      hoster: group?.name ?? null,
      balancerTag: group?.balancerTag ?? null,
    };
  });

  const matched = results.filter(r => r.hoster !== null).length;
  logger.info('IP subnet matching complete', {
    total: results.length,
    matched,
    unmatched: results.length - matched,
  });

  return results;
}
