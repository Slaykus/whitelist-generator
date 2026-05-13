import { z } from 'zod';

const envSchema = z
  .object({
    /** Enable syncing the generated config to Remnawave */
    SYNC_ENABLED: z.coerce.boolean().default(false),

    /** Base URL of the Remnawave panel (required when sync is enabled) */
    REMNAWAVE_URL: z.url().optional(),

    /** API key for the Remnawave panel (required when sync is enabled) */
    REMNAWAVE_API_KEY: z.string().optional(),

    /** UUID of the template to update (required when sync is enabled) */
    REMNAWAVE_TEMPLATE_UUID: z.uuid().optional(),
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

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const errors = parsed.error.issues
    .map(e => `  ${e.path.join('.')}: ${e.message}`)
    .join('\n');

  throw new Error(`Invalid environment configuration:\n${errors}`);
}

export const env = parsed.data;
export type Env = typeof env;
