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
 * Rough walking time. Real routing comes later for the handful of places we
 * actually show; this is the cheap filter that decides which those are.
 */
export function walkingMinutes(metres: number): number {
  const METRES_PER_MINUTE = 80; // ~4.8 km/h
  return Math.round(metres / METRES_PER_MINUTE);
}
