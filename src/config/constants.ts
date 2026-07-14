/** Legacy single-source URL (kept for backward compatibility) */
export const VLESS_LIST_URL =
  'https://raw.githubusercontent.com/zieng2/wl/main/vless_lite.txt' as const;

/**
 * Default public sources of vless:// links. The subnet + speed + bsbord filters
 * keep only servers on whitelisted hoster subnets that actually work, so adding
 * more sources only widens the candidate pool. Override with the SOURCE_URLS env
 * (comma-separated).
 */
export const DEFAULT_SOURCE_URLS: readonly string[] = [
  'https://raw.githubusercontent.com/zieng2/wl/main/vless_lite.txt',
  'https://raw.githubusercontent.com/igareck/vpn-configs-for-russia/main/Vless-Reality-White-Lists-Rus-Mobile.txt',
  // Meta-aggregator (many upstream sources, deduped, updated every minute).
  'https://raw.githubusercontent.com/solovyov-jenya2004/all_subs/main/final_sorted',
];

/** Transport types to exclude from results */
export const DISALLOWED_TYPES: readonly string[] = [];
