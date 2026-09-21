import { parseGuardedJson, UA } from "../ingest/sharedList";
import { haversine } from "../geo";

/**
 * Looks a saved place up on Google Maps to learn what Google calls it —
 * "Georgian restaurant", "Cocktail bar" — which our list data doesn't carry.
 *
 * Same approach as list ingest: Maps' own search XHR (`/search?tbm=map`), a
 * non-browser UA, `)]}'`-guarded JSON. Unofficial and against Google's terms,
 * so it's paced gently (see job.ts) and every field is read defensively: a
 * shape change must yield "no match", never a wrong category.
 *
 * Verified 2026-09-21 against Los Tacos No. 1 and Chama Mama.
 */

export interface GoogleResult {
  name: string;
  /** Primary first, e.g. ["Georgian restaurant", "Eastern European restaurant", "Restaurant"]. */
  categories: string[];
  lat: number;
  lng: number;
  address: string | null;
  googleId: string | null;
}

/**
 * `pb` is Google's positional-parameter encoding. The viewport (`!1d` span in
 * metres, `!2d` lng, `!3d` lat) centres the search on the saved place so the
 * right branch of a chain comes back; the trailing flags ask for full records.
 * Without them the endpoint answers with an empty shell.
 */
const searchUrl = (query: string, lat: number, lng: number) =>
  "https://www.google.com/search?tbm=map&authuser=0&hl=en&gl=us" +
  `&q=${encodeURIComponent(query)}&pb=` +
  encodeURIComponent(
    `!4m12!1m3!1d2000!2d${lng}!3d${lat}!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!7i20` +
      "!10b1!12m6!2m3!5m1!6e2!20e3!10b1!16b1",
  );

/** Reads place records out of a search response. Field positions are observed, not documented. */
export function parseResults(body: string): GoogleResult[] {
  let root: unknown;
  try {
    root = parseGuardedJson(body);
  } catch {
    return [];
  }
  const entries = (root as any)?.[0]?.[1];
  if (!Array.isArray(entries)) return [];

  const results: GoogleResult[] = [];
  for (const entry of entries) {
    const r = entry?.[14];
    const name = r?.[11];
    const categories = r?.[13];
    const lat = r?.[9]?.[2];
    const lng = r?.[9]?.[3];
    if (typeof name !== "string" || !Array.isArray(categories)) continue;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    results.push({
      name,
      categories: categories.filter((c): c is string => typeof c === "string"),
      lat,
      lng,
      address: typeof r[39] === "string" ? r[39] : null,
      googleId: typeof r[78] === "string" ? r[78] : null,
    });
  }
  return results;
}

const words = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

/** Share of the shorter name's words that the other name also has. */
export function nameSimilarity(a: string, b: string): number {
  const wa = words(a);
  const wb = new Set(words(b));
  const shorter = Math.min(wa.length, wb.size);
  if (!shorter) return 0;
  return wa.filter((w) => wb.has(w)).length / shorter;
}

/** Our coordinates come from Google too, so the real match is metres away, not blocks. */
const MAX_METRES = 150;

/**
 * The nearest result that's plausibly the same place. Chains return every
 * branch ("LOS TACOS No.1" ×8), and a loose search returns neighbours with
 * similar names — both are rejected here rather than guessed between.
 */
export function pickMatch(
  saved: { name: string; lat: number; lng: number },
  results: GoogleResult[],
): GoogleResult | null {
  let best: { r: GoogleResult; metres: number } | null = null;
  for (const r of results) {
    const metres = haversine(saved.lat, saved.lng, r.lat, r.lng);
    if (metres > MAX_METRES || nameSimilarity(saved.name, r.name) < 0.5) continue;
    if (!best || metres < best.metres) best = { r, metres };
  }
  return best?.r ?? null;
}

export type Fetcher = (url: string) => Promise<string>;

const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`maps search failed: ${res.status}`);
  return res.text();
};

export async function lookUp(
  saved: { name: string; lat: number; lng: number },
  fetcher: Fetcher = defaultFetcher,
): Promise<GoogleResult | null> {
  const body = await fetcher(searchUrl(saved.name, saved.lat, saved.lng));
  return pickMatch(saved, parseResults(body));
}
