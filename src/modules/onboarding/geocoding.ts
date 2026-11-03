import { z } from "zod";
import { normalizeIanaTimezone } from "./timezone.js";

const geocodingResponseSchema = z.object({
  results: z.array(z.object({
    id: z.number().optional(),
    name: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    timezone: z.string().optional(),
    country: z.string().optional(),
    country_code: z.string().optional(),
    admin1: z.string().optional(),
    feature_code: z.string().optional(),
  })).optional(),
});

export interface GeocodedPlace {
  name: string;
  country: string | null;
  countryCode: string | null;
  admin1: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
}

export class GeocodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeocodingError";
  }
}

const lastSearchByUser = new Map<string, number>();

export async function searchPlaces(city: string, country: string, discordUserId: string): Promise<GeocodedPlace[]> {
  const cleanCity = city.trim();
  const cleanCountry = country.trim();
  if (cleanCity.length < 2 || cleanCity.length > 100 || cleanCountry.length < 2 || cleanCountry.length > 100) {
    throw new GeocodingError("Enter a city and country, each between 2 and 100 characters.");
  }
  const now = Date.now();
  const previousSearch = lastSearchByUser.get(discordUserId);
  if (previousSearch !== undefined && now - previousSearch < 4_000) {
    throw new GeocodingError("Please wait a few seconds before searching for another location.");
  }
  lastSearchByUser.set(discordUserId, now);
  if (lastSearchByUser.size > 2_000) {
    for (const [userId, timestamp] of lastSearchByUser) {
      if (now - timestamp > 60_000) lastSearchByUser.delete(userId);
    }
  }

  const params = new URLSearchParams({ name: cleanCity, count: "10", language: "en" });
  if (/^[a-z]{2}$/i.test(cleanCountry)) {
    params.set("countryCode", cleanCountry.toUpperCase());
  } else {
    params.set("name", `${cleanCity}, ${cleanCountry}`);
  }

  let response: Response;
  try {
    response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new GeocodingError("The location service is temporarily unavailable. Try again shortly.");
  }
  if (!response.ok) {
    throw new GeocodingError("The location service could not complete that search. Try again shortly.");
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new GeocodingError("The location service returned an unreadable response.");
  }
  const parsed = geocodingResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new GeocodingError("The location service returned unexpected data.");
  }

  const places = (parsed.data.results ?? []).flatMap((result): GeocodedPlace[] => {
    const timezone = normalizeIanaTimezone(result.timezone ?? "");
    if (!timezone
      || result.name.length > 120
      || !Number.isFinite(result.latitude)
      || !Number.isFinite(result.longitude)
      || result.latitude < -90
      || result.latitude > 90
      || result.longitude < -180
      || result.longitude > 180) return [];
    return [{
      name: result.name,
      country: result.country ?? null,
      countryCode: /^[a-z]{2}$/i.test(result.country_code ?? "") ? result.country_code?.toUpperCase() ?? null : null,
      admin1: result.admin1 ?? null,
      latitude: result.latitude,
      longitude: result.longitude,
      timezone,
    }];
  });

  if (places.length === 0) {
    throw new GeocodingError("No matching location with a known timezone was found. Check the spelling or try the IANA timezone option.");
  }
  return places;
}
