import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ["DISCORD_TOKEN", "token", "password", "DATABASE_URL", "DIRECT_URL", "*.latitude", "*.longitude"],
    censor: "[REDACTED]",
  },
  base: { service: "prayer-reminder-bot", environment: env.NODE_ENV },
});
