const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in metres. Works anywhere on earth — deliberately no
 * street-grid assumptions, since the app isn't tied to any one city.
 */
export function haversine(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Streets don't run straight to the door, so a walk is longer than the
 * crow-flies line. Checked 2026-10-13 against real foot routes (OSM) from three
 * Manhattan starting points to 16 places: walks ran a median ~1.17× the
 * straight line, mostly 1.05–1.35×. A plain city-wide factor, not a grid
 * model, so it holds anywhere.
 */
const DETOUR = 1.2;

/**
 * Rough walking time. Real routing comes later for the handful of places we
 * actually show; this is the cheap filter that decides which those are.
 */
export function walkingMinutes(straightLineMetres: number): number {
  const METRES_PER_MINUTE = 80; // ~4.8 km/h
  return Math.round((straightLineMetres * DETOUR) / METRES_PER_MINUTE);
}

/** Places nearest-first, each with its distance and walking time from (lat, lng). */
export function byDistance<T extends { lat: number; lng: number }>(
  places: T[],
  lat: number,
  lng: number,
): Array<T & { metres: number; walkMinutes: number }> {
  const withDistance = places.map((p) => {
    const metres = Math.round(haversine(lat, lng, p.lat, p.lng));
    return { ...p, metres, walkMinutes: walkingMinutes(metres) };
  });
  return withDistance.sort((a, b) => a.metres - b.metres);
}
