-- Initial schema for the Muslim Prayer Reminder bot.
-- Creates objects only in muslim_prayer_bot; no existing schema is dropped or altered.
-- This script aborts before making changes if muslim_prayer_bot already contains objects.
BEGIN;
DO $baseline_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'muslim_prayer_bot'
  ) OR EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'muslim_prayer_bot' AND t.typtype IN ('e', 'd', 'c', 'r', 'm')
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'muslim_prayer_bot'
  ) THEN
    RAISE EXCEPTION 'Schema muslim_prayer_bot is not empty; no objects were changed. Choose another empty schema or inspect it first.';
  END IF;
END
$baseline_guard$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "muslim_prayer_bot";

-- CreateEnum
CREATE TYPE "muslim_prayer_bot"."TimeFormat" AS ENUM ('H12', 'H24');

-- CreateEnum
CREATE TYPE "muslim_prayer_bot"."PrayerName" AS ENUM ('FAJR', 'DHUHR', 'ASR', 'MAGHRIB', 'ISHA');

-- CreateEnum
CREATE TYPE "muslim_prayer_bot"."JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."User" (
    "id" TEXT NOT NULL,
    "discordId" VARCHAR(32) NOT NULL,
    "timeFormat" "muslim_prayer_bot"."TimeFormat" NOT NULL DEFAULT 'H12',
    "timezone" VARCHAR(64),
    "countryCode" VARCHAR(2),
    "city" VARCHAR(120),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationUpdatedAt" TIMESTAMPTZ(3),
    "pausedUntil" TIMESTAMPTZ(3),
    "dailyChecklistEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."UserPrayerSettings" (
    "userId" TEXT NOT NULL,
    "calculationMethod" VARCHAR(40) NOT NULL DEFAULT 'MUSLIM_WORLD_LEAGUE',
    "asrMethod" VARCHAR(16) NOT NULL DEFAULT 'STANDARD',
    "highLatitudeRule" VARCHAR(32),
    "fajrAngle" DOUBLE PRECISION,
    "ishaAngle" DOUBLE PRECISION,
    "ishaIntervalMinutes" INTEGER,
    "fajrAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "dhuhrAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "asrAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "maghribAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "ishaAdjustmentMinutes" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserPrayerSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."UserReminderSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prayer" "muslim_prayer_bot"."PrayerName" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "completionPrompt" BOOLEAN NOT NULL DEFAULT true,
    "minutesBefore" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "UserReminderSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."PrayerSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "localDate" DATE NOT NULL,
    "prayer" "muslim_prayer_bot"."PrayerName" NOT NULL,
    "prayerAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "scheduleVersion" INTEGER NOT NULL,
    "calculationKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrayerSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."PrayerRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prayerDate" DATE NOT NULL,
    "prayer" "muslim_prayer_bot"."PrayerName" NOT NULL,
    "completedAt" TIMESTAMPTZ(3) NOT NULL,
    "source" VARCHAR(24) NOT NULL DEFAULT 'SELF_REPORTED',
    "correctedAt" TIMESTAMPTZ(3),

    CONSTRAINT "PrayerRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."DailyPrayerProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prayerDate" DATE NOT NULL,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "finalizedAt" TIMESTAMPTZ(3),
    "fullyCompletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DailyPrayerProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."UserStreak" (
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalCompletedDays" INTEGER NOT NULL DEFAULT 0,
    "totalCompletedPrayers" INTEGER NOT NULL DEFAULT 0,
    "lastFullyCompletedPrayerDate" DATE,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "UserStreak_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."GuildSettings" (
    "guildId" VARCHAR(32) NOT NULL,
    "streakChannelId" VARCHAR(32),
    "communityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "leaderboardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updateFrequency" VARCHAR(16) NOT NULL DEFAULT 'DAILY',
    "weeklySummaryEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuildSettings_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."GuildMemberPrivacySettings" (
    "userId" TEXT NOT NULL,
    "guildId" VARCHAR(32) NOT NULL,
    "publicStreak" BOOLEAN NOT NULL DEFAULT false,
    "showLongest" BOOLEAN NOT NULL DEFAULT false,
    "showTotalDays" BOOLEAN NOT NULL DEFAULT false,
    "optedInAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "GuildMemberPrivacySettings_pkey" PRIMARY KEY ("userId","guildId")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."NotificationJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "muslim_prayer_bot"."JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."NotificationDeliveryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT,
    "deliveredAt" TIMESTAMPTZ(3),
    "failedAt" TIMESTAMPTZ(3),
    "failureCode" VARCHAR(80),

    CONSTRAINT "NotificationDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "muslim_prayer_bot"."AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" VARCHAR(80) NOT NULL,
    "subjectType" VARCHAR(40) NOT NULL,
    "subjectId" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_discordId_key" ON "muslim_prayer_bot"."User"("discordId");

-- CreateIndex
CREATE INDEX "User_timezone_idx" ON "muslim_prayer_bot"."User"("timezone");

-- CreateIndex
CREATE INDEX "UserReminderSettings_userId_enabled_idx" ON "muslim_prayer_bot"."UserReminderSettings"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "UserReminderSettings_userId_prayer_key" ON "muslim_prayer_bot"."UserReminderSettings"("userId", "prayer");

-- CreateIndex
CREATE INDEX "PrayerSchedule_prayerAt_scheduleVersion_idx" ON "muslim_prayer_bot"."PrayerSchedule"("prayerAt", "scheduleVersion");

-- CreateIndex
CREATE INDEX "PrayerSchedule_userId_localDate_idx" ON "muslim_prayer_bot"."PrayerSchedule"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "PrayerSchedule_userId_localDate_prayer_scheduleVersion_key" ON "muslim_prayer_bot"."PrayerSchedule"("userId", "localDate", "prayer", "scheduleVersion");

-- CreateIndex
CREATE INDEX "PrayerRecord_userId_completedAt_idx" ON "muslim_prayer_bot"."PrayerRecord"("userId", "completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrayerRecord_userId_prayerDate_prayer_key" ON "muslim_prayer_bot"."PrayerRecord"("userId", "prayerDate", "prayer");

-- CreateIndex
CREATE INDEX "DailyPrayerProgress_userId_prayerDate_idx" ON "muslim_prayer_bot"."DailyPrayerProgress"("userId", "prayerDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPrayerProgress_userId_prayerDate_key" ON "muslim_prayer_bot"."DailyPrayerProgress"("userId", "prayerDate");

-- CreateIndex
CREATE INDEX "GuildMemberPrivacySettings_guildId_publicStreak_idx" ON "muslim_prayer_bot"."GuildMemberPrivacySettings"("guildId", "publicStreak");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationJob_idempotencyKey_key" ON "muslim_prayer_bot"."NotificationJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationJob_status_dueAt_idx" ON "muslim_prayer_bot"."NotificationJob"("status", "dueAt");

-- CreateIndex
CREATE INDEX "NotificationJob_userId_status_idx" ON "muslim_prayer_bot"."NotificationJob"("userId", "status");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_userId_failedAt_idx" ON "muslim_prayer_bot"."NotificationDeliveryLog"("userId", "failedAt");

-- CreateIndex
CREATE INDEX "NotificationDeliveryLog_jobId_idx" ON "muslim_prayer_bot"."NotificationDeliveryLog"("jobId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "muslim_prayer_bot"."AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_subjectType_subjectId_idx" ON "muslim_prayer_bot"."AuditLog"("subjectType", "subjectId");

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."UserPrayerSettings" ADD CONSTRAINT "UserPrayerSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."UserReminderSettings" ADD CONSTRAINT "UserReminderSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."PrayerSchedule" ADD CONSTRAINT "PrayerSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."PrayerRecord" ADD CONSTRAINT "PrayerRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."DailyPrayerProgress" ADD CONSTRAINT "DailyPrayerProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."UserStreak" ADD CONSTRAINT "UserStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."GuildMemberPrivacySettings" ADD CONSTRAINT "GuildMemberPrivacySettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."GuildMemberPrivacySettings" ADD CONSTRAINT "GuildMemberPrivacySettings_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "muslim_prayer_bot"."GuildSettings"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."NotificationJob" ADD CONSTRAINT "NotificationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."NotificationJob" ADD CONSTRAINT "NotificationJob_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "muslim_prayer_bot"."PrayerSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."NotificationDeliveryLog" ADD CONSTRAINT "NotificationDeliveryLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "muslim_prayer_bot"."NotificationJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "muslim_prayer_bot"."AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "muslim_prayer_bot"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
