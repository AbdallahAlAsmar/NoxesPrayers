-- Additive change for an already initialized muslim_prayer_bot schema.
-- Safe to apply once in the Supabase SQL Editor; existing rows default to enabled.
ALTER TABLE "muslim_prayer_bot"."User"
  ADD COLUMN IF NOT EXISTS "dailyChecklistEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
