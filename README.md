# NoxesPrayers

A private-first prayer companion for Discord. It calculates individual prayer times, sends private reminders and daily checklists, tracks self-reported prayer progress, and offers opt-in community streaks. Built with TypeScript, discord.js, Prisma, and Supabase PostgreSQL. The durable notification queue uses PostgreSQL, so Redis is not required.

## Start the bot

Requirements: Node.js 22+, npm, an existing Supabase project, and a Discord application/bot.

1. Install packages: `npm ci`
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DATABASE_URL`, and `DIRECT_URL`.
3. Generate Prisma Client: `npm run db:generate`
4. Register slash commands once: `npm run commands:deploy`
5. Run locally: `npm run dev`

The bot uses the PostgreSQL schema `muslim_prayer_bot`. For a fresh database, follow the setup steps in [DEPLOYMENT.md](./DEPLOYMENT.md). When upgrading an existing database that has the initial tables but not the daily checklist preference, apply `prisma/manual/20261103010000_daily_checklist.sql` once in the Supabase SQL Editor. Do not reapply the initial SQL or run `npm run db:migrate` against a non-empty schema that has not been baselined.

For `DATABASE_URL`, use your existing Session pooler URL on port 5432 if direct IPv6 access does not work. `DIRECT_URL` is used only by Prisma migrations; do not use Supabase's transaction pooler on port 6543 for migrations. Keep `.env` private and never place service-role keys in the bot.

## Commands

### Private user commands

- `/setup` — choose a timezone setup method and confirm it.
- `/location` and `/timezone` — update the saved city or IANA timezone.
- `/timeformat` — choose 12-hour or 24-hour display.
- `/profile` — see a private overview of your settings and progress.
- `/prayer times`, `/prayer status`, `/prayer log`, `/prayer undo`, `/prayer statistics`, `/prayer settings` — schedules, self-reported tracking, streaks, and calculation preferences.
- `/reminders settings`, `/reminders checklist`, `/reminders pause`, `/reminders resume`, `/reminders test` — manage private DMs, the midnight checklist, and optional heads-up reminders.
- `/privacy show|enable|disable|disconnect` — control visibility in the current server. Public participation is off by default.
- `/delete-data confirm:true` — permanently delete your profile and personal prayer data.
- `/leaderboard` — find this server's opt-in community channel.

### Server administrator commands

- `/server setup-streak-channel` — enable the community snapshot in a text channel.
- `/server streak-settings` — configure leaderboard visibility and daily/weekly frequency.
- `/server disable-streak-channel` — disable and remove bot-authored community snapshots.

The community channel shows only the Discord display name and the opted-in streak fields. It never publishes individual prayers, missed prayers, location, timezone, reminder history, or private records. The bot maintains one current snapshot and updates it when an opted-in member hides or disconnects their streak.

## Prayer tracking rules

- A prayer can be self-reported from its scheduled start until the next prayer begins. Isha's window ends at the following local Fajr.
- The active prayer date changes at Fajr. Before Fajr, Isha and the previous day's progress still belong to yesterday's prayer date.
- A day is finalized at the following Fajr. An incomplete day does not break the current streak before finalization.
- Logging is self-reported; the bot does not verify worship.
- Duplicate prayer records are blocked by a database unique constraint. Accidental entries can be undone within 10 minutes.
- No automatic streak recovery or paid streak protection exists.
- Weekly progress covers the last seven local prayer dates.

## Scheduling and delivery

On startup and at regular intervals, the bot materializes today's and tomorrow's prayer jobs from each user's local schedule. PostgreSQL unique idempotency keys prevent duplicate jobs; `FOR UPDATE SKIP LOCKED` lets multiple workers claim separate due rows safely. Jobs persist across restarts. A worker lease that expires is failed rather than resent, avoiding duplicate DMs when it is unclear whether Discord already accepted the send. Discord's REST client handles rate limits; reminders delayed by more than 15 minutes are expired instead of delivered stale. DM error `50007` suppresses future attempts until `/reminders test` succeeds.

The daily checklist is a private DM at local midnight, enabled by default and configurable with `/reminders checklist`. It summarizes the preceding local prayer date. It lists completed prayers as self-reported, marks a prayer missed only after its completion window ends, and lists any still-open prayer separately (Isha can still be logged until Fajr). A checklist delayed more than 15 minutes expires rather than arriving at an unrelated time.

The bot processes one reminder job once. If a worker loses its connection after Discord accepts a DM but before PostgreSQL records success, delivery status can be uncertain; automatic resend is intentionally avoided in that case. No prayer information is ever posted publicly as a DM fallback.

## Privacy and data retention

- Exact location, timezone, prayer preferences, reminders, prayer records, and statistics are per Discord user and private by default.
- Server administrators cannot query members' individual prayer records through the bot.
- Public streaks require explicit opt-in for each server and can be removed at any time.
- `/delete-data confirm:true` deletes the user and cascades their schedules, jobs, records, statistics, and server privacy choices.
- Notification delivery logs are retained for 30 days; calculated schedule cache rows are retained for 90 days. The latest DM availability marker is retained until a successful `/reminders test` or account deletion, preventing repeated attempts to a disabled DM. Prayer records and daily progress remain until the user deletes their data.

## Scripts and checks

- `npm run dev` — development mode with reload.
- `npm run build` — compile production files into `dist/`.
- `npm start` — run the compiled bot.
- `npm run typecheck` — TypeScript check.
- `npm test` — unit tests.
- `npm run commands:deploy` — register/update application slash commands in Discord.
- `npm run db:generate` — generate Prisma Client.
- `npm run db:deploy` — apply already registered migrations; do not use it before the initial baseline is registered.

The HTTP health endpoints are `/healthz` for liveness and `/readyz` for Discord and database readiness. `HEALTH_PORT` defaults to 3000.

## Deployment

Docker and Docker Compose are configured to run the bot while connecting to your existing Supabase database. See [DEPLOYMENT.md](./DEPLOYMENT.md) for environment, initial schema, health-check, backup, and recovery instructions.
