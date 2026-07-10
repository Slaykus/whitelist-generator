import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .transform(v => v.toLowerCase() === 'true')
    .default(def);

const envSchema = z
  .object({
    /** Enable syncing the generated config to Remnawave */
    SYNC_ENABLED: bool(false),

    /** Base URL of the Remnawave panel (required when sync is enabled) */
    REMNAWAVE_URL: z.url().optional(),

    /** API key for the Remnawave panel (required when sync is enabled) */
    REMNAWAVE_API_KEY: z.string().optional(),

    /** UUID of the template to update (required when sync is enabled) */
    REMNAWAVE_TEMPLATE_UUID: z.uuid().optional(),

    /**
     * When true, the entire template is replaced with the generated config.
     * When false (default), outbounds are merged into the existing remote template.
     */
    OVERWRITE_FULL_CONFIG: bool(false),

    /** Cron for the cheap light re-check (availability + latency only) */
    SCHEDULE_CRON: z.string().default('*/30 * * * *'),

    /** Cron for the full speed re-test + re-selection (heavier) */
    FULL_TEST_CRON: z.string().default('0 */3 * * *'),

    /** Enable speed/latency testing and keep only the fastest servers */
    TEST_ENABLED: bool(false),

    /** How many of the fastest servers to keep (0 = keep all passing) */
    TEST_TOP_N: z.coerce.number().int().min(0).default(10),

    /** Cap the number of candidates actually tested (0 = test all) */
    TEST_LIMIT: z.coerce.number().int().min(0).default(0),

    /** Number of servers tested in parallel */
    TEST_CONCURRENCY: z.coerce.number().int().min(1).default(5),

    /** First local SOCKS port used for tests (each candidate gets basePort+index) */
    TEST_BASE_PORT: z.coerce.number().int().min(1024).default(11800),

    /** URL used to check availability + latency */
    TEST_LATENCY_URL: z.url().default('https://www.gstatic.com/generate_204'),

    /** URL used to measure download throughput */
    TEST_DOWNLOAD_URL: z.url().default('https://speed.cloudflare.com/__down?bytes=20000000'),

    /** Per-request timeout in ms for the test curls */
    TEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),

    /** Minimum download speed in Mbps to keep a server (0 = no floor) */
    TEST_MIN_SPEED_MBPS: z.coerce.number().min(0).default(40),

    /** Maximum acceptable latency in ms (0 = no cap) */
    TEST_MAX_LATENCY_MS: z.coerce.number().int().min(0).default(0),

    /** Path to xray-core binary used by the tester */
    XRAY_BIN: z.string().default('xray'),

    /** Where to write the full ranked test report */
    TEST_RESULTS_PATH: z.string().default('tested-results.json'),

    /** Where to persist the currently selected servers between runs */
    SELECTED_STATE_PATH: z.string().default('selected.json'),

    /** Enable bsbord operator-universality filter (needs BSBORD_API_KEY) */
    BSBORD_ENABLED: bool(false),
    BSBORD_API_KEY: z.string().optional(),
    BSBORD_API_URL: z.url().default('https://bsbord.com/v1'),
    /** 'on' = only DPI-active operators (real BS); 'any' = include non-BS */
    BSBORD_DPI: z.string().default('on'),
    /** Skip the filter if fewer operators are alive (don't starve the pool) */
    BSBORD_MIN_OPERATORS: z.coerce.number().int().min(1).default(2),
    /** Cache a verdict per endpoint for this long, so repeat runs don't re-pay */
    BSBORD_CACHE_TTL_HOURS: z.coerce.number().min(0).default(24),
    BSBORD_CACHE_PATH: z.string().default('bsbord-cache.json'),
    /** Speed-test pool feeding the filter = TEST_TOP_N * this */
    BSBORD_OVERSAMPLE: z.coerce.number().int().min(1).default(3),
    /** Min fraction of live operators a server must pass (1 = all, 0.9 = 90%) */
    BSBORD_MIN_OK_RATIO: z.coerce.number().min(0).max(1).default(1),
    /** Comma-separated list of source URLs (overrides DEFAULT_SOURCE_URLS) */
    SOURCE_URLS: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (!data.SYNC_ENABLED) return;

    const required: Array<keyof typeof data> = [
      'REMNAWAVE_URL',
      'REMNAWAVE_API_KEY',
      'REMNAWAVE_TEMPLATE_UUID',
    ];

    for (const key of required) {
      if (!data[key]) {
        ctx.addIssue({
          code: 'custom',
          message: `${key} is required when SYNC_ENABLED=true`,
          path: [key],
        });
      }
    }
  });

const parsed = envSchema.safeParse(Bun.env);

if (!parsed.success) {
  const errors = parsed.error.issues
    .map(e => `  ${e.path.join('.')}: ${e.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${errors}`);
}

export const env = parsed.data;
export type Env = typeof env;
