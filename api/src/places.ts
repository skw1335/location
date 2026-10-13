import { db } from "./db";
import { ACTIVE_SUB, EFFECTIVE } from "./categories/effective";
import type { Place } from "./types";

/** What to narrow the list to. Every filter is optional and they combine. */
export interface PlaceFilter {
  category?: string;
  /** A subcategory of `category`; meaningless without it. */
  subcategory?: string;
  cuisine?: string;
}

/**
 * Every place across every list the user has connected.
 *
 * The user's overrides outrank anything derived, and hidden places never leave
 * the server at all. Filtering happens here rather than on the phone so the
 * client only ever receives what it's about to draw.
 */
export function allPlaces(userKey: string, filter: PlaceFilter = {}): Place[] {
  const { category = null, subcategory = null, cuisine = null } = filter;
  const rows = db
    .query(
      `SELECT e.id, e.name, e.lat, e.lng, e.address, e.note,
              e.list_name AS listName, e.eff_category AS category,
              e.eff_source AS categorySource, e.eff_cuisine AS cuisine,
              e.eff_cuisine_source AS cuisineSource, e.eff_price AS price,
              (SELECT json_group_array(name) FROM
                 (SELECT name FROM place_subcategories s WHERE ${ACTIVE_SUB}
                   ORDER BY name)) AS subcategories
       FROM (${EFFECTIVE}) e
       WHERE (?2 IS NULL OR e.eff_category = ?2)
         AND (?3 IS NULL OR EXISTS (SELECT 1 FROM place_subcategories s
                WHERE ${ACTIVE_SUB} AND s.name = ?3))
         AND (?4 IS NULL OR e.eff_cuisine = ?4)`,
    )
    .all(userKey, category, subcategory, cuisine) as Array<
    Omit<Place, "subcategories"> & { subcategories: string }
  >;
  return rows.map((r) => ({ ...r, subcategories: JSON.parse(r.subcategories) as string[] }));
}
