import { afterEach, describe, expect, it, vi } from "vitest";
import { GeocodingError, searchPlaces } from "./geocoding.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("searchPlaces", () => {
  it("uses an unambiguous country-code filter and validates the returned timezone", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        id: 1,
        name: "Kathmandu",
        latitude: 27.7172,
        longitude: 85.324,
        timezone: "Asia/Kathmandu",
        country: "Nepal",
        country_code: "NP",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchPlaces("Kathmandu", "np", "geocode-test-country-code");
    expect(result).toEqual([{
      name: "Kathmandu",
      country: "Nepal",
      countryCode: "NP",
      admin1: null,
      latitude: 27.7172,
      longitude: 85.324,
      timezone: "Asia/Kathmandu",
    }]);
    const requestedUrl = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(requestedUrl.searchParams.get("countryCode")).toBe("NP");
    expect(requestedUrl.searchParams.get("name")).toBe("Kathmandu");
  });

  it("rejects results without a usable IANA timezone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{ name: "Example", latitude: 1, longitude: 2, timezone: "invalid/zone" }],
    }), { status: 200 })));
    await expect(searchPlaces("Example", "XY", "geocode-test-invalid-zone"))
      .rejects.toBeInstanceOf(GeocodingError);
  });

  it("returns a friendly error for an empty result set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [] }), { status: 200 })));
    await expect(searchPlaces("No Such Place", "ZZ", "geocode-test-empty"))
      .rejects.toThrow("No matching location");
  });
});
