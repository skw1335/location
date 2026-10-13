import { sql } from "../../db";

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long each outcome stands before the place is looked up again. Matches
 * rarely change; a miss may be a place Google hadn't indexed yet; an error is
 * usually transient.
 */
const RECHECK_AFTER = { matched: 90 * DAY, no_match: 30 * DAY, error: 1 * DAY };

/** Places, across all users, that have never been looked up or are due again. */
export async function placesToLookUp(
  limit: number,
  now = Date.now(),
): Promise<Array<{ id: string; name: string; lat: number; lng: number }>> {
  const before = (ms: number) => new Date(now - ms);
  return await sql`
    SELECT p.id, MIN(p.name) AS name, MIN(p.lat) AS lat, MIN(p.lng) AS lng
    FROM places p
    LEFT JOIN place_lookups g ON g.place_id = p.id
    WHERE g.place_id IS NULL
       OR (g.status = 'matched'  AND g.checked_at < ${before(RECHECK_AFTER.matched)})
       OR (g.status = 'no_match' AND g.checked_at < ${before(RECHECK_AFTER.no_match)})
       OR (g.status = 'error'    AND g.checked_at < ${before(RECHECK_AFTER.error)})
    GROUP BY p.id, g.checked_at
    ORDER BY g.checked_at IS NOT NULL, g.checked_at
    LIMIT ${limit}`;
}

export async function saveLookup(
  placeId: string,
  lookup:
    | {
        status: "matched";
        googleId: string | null;
        googleCategories: string[];
        category: string | null;
        cuisine: string | null;
      }
    | { status: "no_match" | "error" },
  now = Date.now(),
) {
  const m = lookup.status === "matched" ? lookup : null;
  // Bun.sql JSON-encodes the value itself; a pre-stringified array would be
  // stored as one JSON string.
  const googleCategories = m?.googleCategories ?? null;
  await sql`
    INSERT INTO place_lookups
      (place_id, status, google_id, google_categories, category, cuisine, checked_at)
    VALUES (${placeId}, ${lookup.status}, ${m?.googleId ?? null}, ${googleCategories}::jsonb,
            ${m?.category ?? null}, ${m?.cuisine ?? null}, ${new Date(now)})
    ON CONFLICT (place_id) DO UPDATE SET
      status = excluded.status, google_id = excluded.google_id,
      google_categories = excluded.google_categories, category = excluded.category,
      cuisine = excluded.cuisine, checked_at = excluded.checked_at`;
}

/**
 * Recomputes category and cuisine for every matched lookup from the Google
 * categories already stored. Run at startup, so a change to the mapping rules
 * applies to everything without a single new request to Google.
 */
export const rederiveLookups = (
  derive: (googleCategories: string[]) => { category: string | null; cuisine: string | null },
) =>
  sql.begin(async (tx): Promise<number> => {
    const rows: Array<{ place_id: string; google_categories: string[] | null }> = await tx`
      SELECT place_id, google_categories FROM place_lookups WHERE status = 'matched'`;
    for (const row of rows) {
      const { category, cuisine } = derive(row.google_categories ?? []);
      await tx`UPDATE place_lookups SET category = ${category}, cuisine = ${cuisine}
               WHERE place_id = ${row.place_id}`;
    }
    return rows.length;
  });
