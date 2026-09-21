/**
 * Builds a Maps search response with the same shape as the real one: a `)]}'`
 * guard, then results at [0][1][i][14] with name at [11], categories at [13],
 * coordinates at [9][2..3], address at [39], Google id at [78].
 */
export function mapsResponse(
  places: Array<{ name: string; categories: string[]; lat: number; lng: number; id?: string }>,
): string {
  const entries = places.map((p) => {
    const record: unknown[] = new Array(80).fill(null);
    record[9] = [null, null, p.lat, p.lng];
    record[11] = p.name;
    record[13] = p.categories;
    record[39] = "1 Somewhere St";
    record[78] = p.id ?? `ChIJ-${p.name}`;
    const entry: unknown[] = new Array(15).fill(null);
    entry[14] = record;
    return entry;
  });
  // The real response leads with a non-place entry.
  return `)]}'\n${JSON.stringify([["query", [[null], ...entries]]])}`;
}
