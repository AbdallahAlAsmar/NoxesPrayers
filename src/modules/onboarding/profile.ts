import { prisma } from "../../db/client.js";

export interface PendingProfile {
  timezone: string;
  city: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
}

export type PreferredTimeFormat = "H12" | "H24";

export async function getExistingProfile(discordId: string): Promise<PendingProfile | null> {
  const user = await prisma.user.findUnique({
    where: { discordId },
    select: { timezone: true, city: true, countryCode: true, latitude: true, longitude: true },
  });
  if (!user || !user.timezone) return null;
  return { ...user, timezone: user.timezone };
}

export async function saveConfirmedProfile(discordId: string, profile: PendingProfile): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { discordId },
    select: { timezone: true, city: true, countryCode: true, latitude: true, longitude: true, locationUpdatedAt: true },
  });
  const scheduleChanged = !existing
    || existing.timezone !== profile.timezone
    || existing.latitude !== profile.latitude
    || existing.longitude !== profile.longitude;
  const locationChanged = !existing
    || existing.city !== profile.city
    || existing.countryCode !== profile.countryCode
    || existing.latitude !== profile.latitude
    || existing.longitude !== profile.longitude;

  const locationUpdatedAt = locationChanged
    ? (profile.latitude !== null && profile.longitude !== null ? new Date() : null)
    : existing.locationUpdatedAt;

  await prisma.user.upsert({
    where: { discordId },
    create: {
      discordId,
      timezone: profile.timezone,
      city: profile.city,
      countryCode: profile.countryCode,
      latitude: profile.latitude,
      longitude: profile.longitude,
      locationUpdatedAt,
    },
    update: {
      timezone: profile.timezone,
      city: profile.city,
      countryCode: profile.countryCode,
      latitude: profile.latitude,
      longitude: profile.longitude,
      locationUpdatedAt,
      ...(scheduleChanged ? { scheduleVersion: { increment: 1 } } : {}),
    },
  });
}

export async function saveTimeFormat(discordId: string, timeFormat: PreferredTimeFormat): Promise<void> {
  await prisma.user.upsert({
    where: { discordId },
    create: { discordId, timeFormat },
    update: { timeFormat },
  });
}
