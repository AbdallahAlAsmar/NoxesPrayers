import "dotenv/config";
import { defineConfig, env } from "prisma/config";

const migrationUrl = new URL(env("DIRECT_URL"));
migrationUrl.searchParams.set("schema", "muslim_prayer_bot");

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: migrationUrl.toString() },
});
