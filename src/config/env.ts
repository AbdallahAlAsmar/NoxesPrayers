import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().regex(/^\d{17,20}$/),
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url(),
  HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).default(Number(process.env.PORT ?? 3000)),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid environment configuration. Check: ${fields}`);
}

export const env = parsed.data;
