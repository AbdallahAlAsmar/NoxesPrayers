import { createHash } from "node:crypto";
import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PolarCircleResolution, PrayerTimes } from "adhan";
import { DateTime } from "luxon";
import type { UserPrayerSettingsModel } from "../../generated/prisma/models/UserPrayerSettings.js";

export const PRAYERS = ["FAJR", "DHUHR", "ASR", "MAGHRIB", "ISHA"] as const;
const CALCULATION_ENGINE_VERSION = "adhan-4.4.6-polar-balad-v1";
export type PrayerCode = typeof PRAYERS[number];
export type CalculationMethodCode = "MUSLIM_WORLD_LEAGUE" | "NORTH_AMERICA" | "EGYPTIAN" | "UMM_AL_QURA" | "KARACHI" | "DUBAI" | "MOONSIGHTING_COMMITTEE" | "KUWAIT" | "QATAR" | "SINGAPORE" | "TEHRAN" | "TURKEY";
export type AsrMethodCode = "STANDARD" | "HANAFI";
export type HighLatitudeCode = "RECOMMENDED" | "MIDDLE_OF_THE_NIGHT" | "SEVENTH_OF_THE_NIGHT" | "TWILIGHT_ANGLE";

export interface PrayerCalculationSettings {
  calculationMethod: string;
  asrMethod: string;
  highLatitudeRule: string | null;
  fajrAngle: number | null;
  ishaAngle: number | null;
  ishaIntervalMinutes: number | null;
  fajrAdjustmentMinutes: number;
  dhuhrAdjustmentMinutes: number;
  asrAdjustmentMinutes: number;
  maghribAdjustmentMinutes: number;
  ishaAdjustmentMinutes: number;
}

export interface PrayerScheduleResult {
  prayer: PrayerCode;
  at: Date;
}

const methodFactories = {
  MUSLIM_WORLD_LEAGUE: CalculationMethod.MuslimWorldLeague,
  NORTH_AMERICA: CalculationMethod.NorthAmerica,
  EGYPTIAN: CalculationMethod.Egyptian,
  UMM_AL_QURA: CalculationMethod.UmmAlQura,
  KARACHI: CalculationMethod.Karachi,
  DUBAI: CalculationMethod.Dubai,
  MOONSIGHTING_COMMITTEE: CalculationMethod.MoonsightingCommittee,
  KUWAIT: CalculationMethod.Kuwait,
  QATAR: CalculationMethod.Qatar,
  SINGAPORE: CalculationMethod.Singapore,
  TEHRAN: CalculationMethod.Tehran,
  TURKEY: CalculationMethod.Turkey,
} satisfies Record<CalculationMethodCode, () => ReturnType<typeof CalculationMethod.MuslimWorldLeague>>;

const highLatitudeRules = {
  MIDDLE_OF_THE_NIGHT: HighLatitudeRule.MiddleOfTheNight,
  SEVENTH_OF_THE_NIGHT: HighLatitudeRule.SeventhOfTheNight,
  TWILIGHT_ANGLE: HighLatitudeRule.TwilightAngle,
} satisfies Record<Exclude<HighLatitudeCode, "RECOMMENDED">, string>;

function validMethod(value: string): value is CalculationMethodCode {
  return Object.hasOwn(methodFactories, value);
}

function validHighLatitudeRule(value: string): value is HighLatitudeCode {
  return value === "RECOMMENDED" || Object.hasOwn(highLatitudeRules, value);
}

function validSettings(settings: PrayerCalculationSettings): void {
  if (!validMethod(settings.calculationMethod)) throw new Error("Unsupported prayer calculation method.");
  if (settings.asrMethod !== "STANDARD" && settings.asrMethod !== "HANAFI") throw new Error("Unsupported Asr method.");
  if (settings.highLatitudeRule !== null && !validHighLatitudeRule(settings.highLatitudeRule)) throw new Error("Unsupported high-latitude rule.");
  if (settings.fajrAngle !== null && (!Number.isFinite(settings.fajrAngle) || settings.fajrAngle < 0 || settings.fajrAngle > 30)) throw new Error("Fajr angle must be between 0 and 30 degrees.");
  if (settings.ishaAngle !== null && (!Number.isFinite(settings.ishaAngle) || settings.ishaAngle < 0 || settings.ishaAngle > 30)) throw new Error("Isha angle must be between 0 and 30 degrees.");
  if (settings.ishaIntervalMinutes !== null && (!Number.isInteger(settings.ishaIntervalMinutes) || settings.ishaIntervalMinutes < 0 || settings.ishaIntervalMinutes > 180)) throw new Error("Isha interval must be between 0 and 180 minutes.");
  for (const adjustment of [settings.fajrAdjustmentMinutes, settings.dhuhrAdjustmentMinutes, settings.asrAdjustmentMinutes, settings.maghribAdjustmentMinutes, settings.ishaAdjustmentMinutes]) {
    if (!Number.isInteger(adjustment) || adjustment < -60 || adjustment > 60) throw new Error("Prayer adjustments must be whole minutes between -60 and 60.");
  }
}

export function settingsFromRecord(settings: UserPrayerSettingsModel | null): PrayerCalculationSettings {
  return {
    calculationMethod: settings?.calculationMethod ?? "MUSLIM_WORLD_LEAGUE",
    asrMethod: settings?.asrMethod ?? "STANDARD",
    highLatitudeRule: settings?.highLatitudeRule ?? "RECOMMENDED",
    fajrAngle: settings?.fajrAngle ?? null,
    ishaAngle: settings?.ishaAngle ?? null,
    ishaIntervalMinutes: settings?.ishaIntervalMinutes ?? null,
    fajrAdjustmentMinutes: settings?.fajrAdjustmentMinutes ?? 0,
    dhuhrAdjustmentMinutes: settings?.dhuhrAdjustmentMinutes ?? 0,
    asrAdjustmentMinutes: settings?.asrAdjustmentMinutes ?? 0,
    maghribAdjustmentMinutes: settings?.maghribAdjustmentMinutes ?? 0,
    ishaAdjustmentMinutes: settings?.ishaAdjustmentMinutes ?? 0,
  };
}

export function calculationKey(settings: PrayerCalculationSettings): string {
  validSettings(settings);
  return createHash("sha256").update(JSON.stringify({ engine: CALCULATION_ENGINE_VERSION, settings })).digest("hex").slice(0, 40);
}

/**
 * Calculate times for a calendar day in the user's timezone. Adhan accepts
 * year/month/day from a local Date, while returning absolute instants. Construct
 * the input from the requested calendar fields and format results using the
 * user's IANA timezone; never use the host timezone to display the result.
 */
export function calculatePrayerTimes(input: {
  latitude: number;
  longitude: number;
  timezone: string;
  localDate: string;
  settings: PrayerCalculationSettings;
}): PrayerScheduleResult[] {
  const { latitude, longitude, timezone, localDate, settings } = input;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Saved coordinates are invalid.");
  }
  const day = DateTime.fromISO(localDate, { zone: timezone });
  if (!day.isValid || day.toISODate() !== localDate) throw new Error("A valid local date and IANA timezone are required.");
  validSettings(settings);

  const coordinates = new Coordinates(latitude, longitude);
  const parameters = methodFactories[settings.calculationMethod as CalculationMethodCode]();
  // Adhan defaults this to Unresolved. AqrabBalad is needed to calculate solar
  // times inside the polar circle, where sunrise/sunset may not occur daily.
  parameters.polarCircleResolution = PolarCircleResolution.AqrabBalad;
  parameters.madhab = settings.asrMethod === "HANAFI" ? Madhab.Hanafi : Madhab.Shafi;
  const highRule = settings.highLatitudeRule ?? "RECOMMENDED";
  parameters.highLatitudeRule = highRule === "RECOMMENDED"
    ? HighLatitudeRule.recommended(coordinates)
    : highLatitudeRules[highRule as Exclude<HighLatitudeCode, "RECOMMENDED">];
  if (settings.fajrAngle !== null) parameters.fajrAngle = settings.fajrAngle;
  if (settings.ishaAngle !== null) parameters.ishaAngle = settings.ishaAngle;
  if (settings.ishaIntervalMinutes !== null) parameters.ishaInterval = settings.ishaIntervalMinutes;
  parameters.adjustments.fajr = settings.fajrAdjustmentMinutes;
  parameters.adjustments.dhuhr = settings.dhuhrAdjustmentMinutes;
  parameters.adjustments.asr = settings.asrAdjustmentMinutes;
  parameters.adjustments.maghrib = settings.maghribAdjustmentMinutes;
  parameters.adjustments.isha = settings.ishaAdjustmentMinutes;

  const dateInput = new Date(day.year, day.month - 1, day.day, 12, 0, 0, 0);
  const times = new PrayerTimes(coordinates, dateInput, parameters);
  const result: PrayerScheduleResult[] = [
    { prayer: "FAJR", at: times.fajr },
    { prayer: "DHUHR", at: times.dhuhr },
    { prayer: "ASR", at: times.asr },
    { prayer: "MAGHRIB", at: times.maghrib },
    { prayer: "ISHA", at: times.isha },
  ];
  if (result.some(({ at }) => !Number.isFinite(at.getTime()))) throw new Error("Prayer times could not be calculated for this date and location. Try a different high-latitude rule.");
  return result;
}

export function formatPrayerTime(at: Date, timezone: string, timeFormat: "H12" | "H24"): string {
  const local = DateTime.fromJSDate(at, { zone: timezone });
  if (!local.isValid) throw new Error("Could not format prayer time in the saved timezone.");
  return local.toFormat(timeFormat === "H12" ? "h:mm a" : "HH:mm");
}

export function settingsRecordToInput(settings: UserPrayerSettingsModel | null): PrayerCalculationSettings {
  return settingsFromRecord(settings);
}
