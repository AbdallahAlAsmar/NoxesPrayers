# Deployment and recovery

## Existing Supabase database

If the `muslim_prayer_bot` schema already has the bot tables but lacks the daily checklist preference, apply `prisma/manual/20261103010000_daily_checklist.sql` once in the Supabase SQL Editor. It adds a column with a default and does not delete or rewrite existing data. If the column is already present, no SQL change is needed.

Do not reapply `prisma/migrations/20261103000000_init/migration.sql` to a database that already has the bot tables. The script is for an empty bot schema and intentionally stops if that schema is populated. Do not run `npm run db:migrate` against a non-empty, un-baselined schema; Prisma will report P3005.

## New Supabase project only

1. Create a Supabase project and copy its PostgreSQL connection strings from the dashboard.
2. Put the Session pooler connection (port 5432) in `DATABASE_URL` and `DIRECT_URL` when direct IPv6 connectivity is unavailable. Never use the transaction pooler (port 6543) for migrations.
3. Apply `prisma/migrations/20261103000000_init/migration.sql` once in the Supabase SQL Editor. It creates only the `muslim_prayer_bot` namespace.
4. From the project folder, register the manually applied baseline: `npx prisma migrate resolve --applied 20261103000000_init`.
5. For later schema migrations, use `npm run db:migrate` in development and `npm run db:deploy` in deployment after reviewing the migration SQL.

For an existing schema, do not reapply the initial SQL. Do not run `npm run db:migrate` against a non-empty, un-baselined schema.

## Discord configuration

Set `DISCORD_TOKEN` and `DISCORD_APPLICATION_ID` in `.env`. The bot only requests the `Guilds` gateway intent. Slash commands are private/ephemeral where they concern an individual user; the only public posts are opted-in streak summaries.

Run `npm run commands:deploy` once after installing or changing slash command definitions. This updates the Discord application command list. Then start the bot with `npm run dev` locally or `npm start` after `npm run build`.

After adding the bot to a server:

1. Each member runs `/setup` and `/location`, then confirms their city/timezone.
2. Members run `/prayer settings` and `/reminders settings` if they want non-default preferences.
3. To enable community features, an administrator with Manage Server runs `/server setup-streak-channel channel:#channel`.
4. Members who want to appear run `/privacy enable` in that server. It is disabled by default.

## Docker

The image builds Prisma Client without contacting Supabase. Runtime configuration is supplied from `.env`; the image excludes `.env` and does not contain secrets.

```powershell
docker compose up --build -d
docker compose logs -f prayer-bot
```

The container uses `restart: unless-stopped` and runs as the unprivileged Node user. Docker's healthcheck probes `/readyz`; the optional host port is bound only to `127.0.0.1` (default 3000), so it is not public. `/healthz` checks process liveness. `/readyz` returns success only when the Discord gateway is ready and PostgreSQL responds. The bot needs outbound Internet access to Discord and Supabase; no inbound Discord port is required.

### VPS deployment

Install Docker Engine and the Compose plugin on your Ubuntu server. Clone or copy the project into a dedicated application directory, create `.env` from `.env.example`, and restrict it to the deployment user (`chmod 600 .env`). The health endpoint is bound to loopback only, so do not expose port 3000 publicly.

From the project directory, build and start the bot:

```bash
docker compose up -d --build
docker compose ps
docker compose logs -f prayer-bot
curl -fsS http://127.0.0.1:3000/readyz
```

After updating command definitions, register them from the running container with `docker compose exec -T prayer-bot node dist/commands/deploy.js`. For updates, pull or copy the new code and run `docker compose up -d --build`. Do not run database reset commands. Review migration instructions before deploying any future schema change.

## Scheduling, downtime, and recovery

The PostgreSQL queue is durable. Schedule generation refreshes every five minutes, workers poll every five seconds, and a queue row is claimed with PostgreSQL `FOR UPDATE SKIP LOCKED`. A job unique key prevents rescheduling the same user/prayer/date/version. Expired processing leases are failed rather than resent because Discord may already have accepted a DM. This favors avoiding duplicate reminders where delivery status is uncertain. A job more than 15 minutes late is expired and logged; it is not sent as a stale prayer alert.

When PostgreSQL or Discord is unavailable, the bot logs a structured error category without logging prayer data, coordinates, tokens, or stack traces to the user. The process reconnects through the Node PostgreSQL pool and discord.js gateway. Check `/readyz`, container logs, Supabase project status, and the connection string after an outage. If a free Supabase project was paused, resume it in the Supabase dashboard; the existing data is retained.

The bot prunes delivery logs after 30 days, completed/failed/cancelled queue rows after 30 days, and cached prayer schedules after 90 days. It retains only the latest DM availability marker until a successful `/reminders test` or account deletion. Prayer records and daily progress are retained until their owner runs `/delete-data confirm:true`.

## Backups and Supabase Free plan

Keep an off-site logical database export before important schema or deployment changes. Supabase Free projects do not provide downloadable automatic backups; use Supabase's documented CLI export procedure and store the export in a private, encrypted location. Test restoring the export to a separate project before relying on it. Free projects may pause after a week with too little database activity, and activity does not guarantee that a project will never be paused.

Official Supabase references: [database connection modes](https://supabase.com/docs/guides/database/connecting-to-postgres), [backup guidance](https://supabase.com/docs/guides/platform/backups), [free project pausing](https://supabase.com/kb/faqs/platform/free-project-pausing).

## Operational checks

Before release, run:

```powershell
npm test
npm run typecheck
npm run build
```

Then verify `/readyz`, run `/reminders test` for DM delivery, check `/prayer times` for a configured profile, and test a prayer completion only within its current prayer window. Community testing should use a private test server and a test account that explicitly opts in.
