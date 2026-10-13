import { db } from "../../db";

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long each outcome stands before the place is looked up again. Matches
 * rarely change; a miss may be a place Google hadn't indexed yet; an error is
 * usually transient.
 */
const RECHECK_AFTER = { matched: 90 * DAY, no_match: 30 * DAY, error: 1 * DAY };

/** Places, across all users, that have never been looked up or are due again. */
export function placesToLookUp(
  limit: number,
  now = Date.now(),
): Array<{ id: string; name: string; lat: number; lng: number }> {
  return db
    .query(
      `SELECT p.id, MIN(p.name) AS name, MIN(p.lat) AS lat, MIN(p.lng) AS lng
       FROM places p
       LEFT JOIN place_lookups g ON g.place_id = p.id
       WHERE g.place_id IS NULL
          OR (g.status = 'matched'  AND g.checked_at < ?1)
          OR (g.status = 'no_match' AND g.checked_at < ?2)
          OR (g.status = 'error'    AND g.checked_at < ?3)
       GROUP BY p.id
       ORDER BY g.checked_at IS NOT NULL, g.checked_at
       LIMIT ?4`,
    )
    .all(
      now - RECHECK_AFTER.matched,
      now - RECHECK_AFTER.no_match,
      now - RECHECK_AFTER.error,
      limit,
    ) as Array<{ id: string; name: string; lat: number; lng: number }>;
}

export function saveLookup(
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
  db.query(
    `INSERT OR REPLACE INTO place_lookups
       (place_id, status, google_id, google_categories, category, cuisine, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    placeId,
    lookup.status,
    m?.googleId ?? null,
    m ? JSON.stringify(m.googleCategories) : null,
    m?.category ?? null,
    m?.cuisine ?? null,
    now,
  );
}

/**
 * Recomputes category and cuisine for every matched lookup from the Google
 * categories already stored. Run at startup, so a change to the mapping rules
 * applies to everything without a single new request to Google.
 */
export const rederiveLookups = db.transaction(
  (derive: (googleCategories: string[]) => { category: string | null; cuisine: string | null }) => {
    const rows = db
      .query(`SELECT place_id, google_categories FROM place_lookups WHERE status = 'matched'`)
      .all() as Array<{ place_id: string; google_categories: string | null }>;
    const update = db.query(`UPDATE place_lookups SET category = ?, cuisine = ? WHERE place_id = ?`);
    for (const row of rows) {
      const { category, cuisine } = derive(JSON.parse(row.google_categories ?? "[]"));
      update.run(category, cuisine, row.place_id);
    }
    return rows.length;
  },
);
