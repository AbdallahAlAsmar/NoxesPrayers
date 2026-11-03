export type ClockParseResult =
  | { ok: true; minuteOfDay: number }
  | { ok: false; reason: "invalid" | "ambiguous" };

export interface TimezoneCandidate {
  timeZone: string;
  offsetMinutes: number;
}

const TIMEZONE_NAMES = [
  "UTC",
  ...Intl.supportedValuesOf("timeZone").filter((name) => name !== "UTC"),
];

export function parseLocalClock(input: string): ClockParseResult {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(input.trim());
  if (!match) return { ok: false, reason: "invalid" };

  const hourText = match[1];
  const minuteText = match[2];
  const meridiem = match[3]?.toUpperCase();
  if (!hourText || !minuteText) return { ok: false, reason: "invalid" };

  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || minute < 0 || minute > 59) {
    return { ok: false, reason: "invalid" };
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) return { ok: false, reason: "invalid" };
    return {
      ok: true,
      minuteOfDay: ((hour % 12) + (meridiem === "PM" ? 12 : 0)) * 60 + minute,
    };
  }

  // A one-digit 1–12 hour has two plausible meanings without AM/PM.
  if (hourText.length === 1 && hour >= 1 && hour <= 12) {
    return { ok: false, reason: "ambiguous" };
  }
  if (hour < 0 || hour > 23) return { ok: false, reason: "invalid" };
  return { ok: true, minuteOfDay: hour * 60 + minute };
}

export function normalizeIanaTimezone(input: string): string | null {
  const candidate = input.trim();
  if (!candidate || candidate.length > 64) return null;
  try {
    // Validate with the runtime database but preserve the exact IANA ID the
    // user or geocoder supplied; ICU may resolve valid aliases differently.
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return null;
  }
}

export function getUtcOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const value = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(at).find((part) => part.type === "timeZoneName")?.value;

    if (!value || value === "GMT" || value === "UTC") return 0;
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value);
    if (!match) return null;
    const sign = match[1] === "+" ? 1 : -1;
    return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return null;
  }
}

export function estimateTimezonesFromLocalClock(
  minuteOfDay: number,
  submittedAt: Date,
): TimezoneCandidate[] {
  const utcMinute = submittedAt.getUTCHours() * 60 + submittedAt.getUTCMinutes();
  const rawDifference = minuteOfDay - utcMinute;
  const plausibleOffsets = new Set<number>();

  // Minute-entry and interaction latency can cross a minute boundary. Keep a
  // one-minute tolerance, while preserving both date-line interpretations.
  for (const correction of [-1, 0, 1]) {
    for (const dayWrap of [-1440, 0, 1440]) {
      const offset = rawDifference + correction + dayWrap;
      if (offset >= -720 && offset <= 840) plausibleOffsets.add(offset);
    }
  }

  const candidates: TimezoneCandidate[] = [];
  for (const timeZone of TIMEZONE_NAMES) {
    const offsetMinutes = getUtcOffsetMinutes(timeZone, submittedAt);
    if (offsetMinutes !== null && plausibleOffsets.has(offsetMinutes)) {
      candidates.push({ timeZone, offsetMinutes });
    }
  }

  return candidates.sort((a, b) =>
    a.timeZone.localeCompare(b.timeZone, "en", { sensitivity: "base" }),
  );
}

export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60).toString().padStart(2, "0");
  const minutes = (absolute % 60).toString().padStart(2, "0");
  return `UTC${sign}${hours}:${minutes}`;
}

export function formatUtcClock(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}
