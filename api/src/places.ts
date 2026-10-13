import { sql } from "./db";
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
 * the server at all (see `effective_places` in schema.sql). Filtering happens
 * here rather than on the phone so the client only ever receives what it's
 * about to draw.
 *
 * A place's subcategories only count while it sits in their parent. Moving a
 * place from food to drink hides its food subcategories rather than deleting
 * them, so moving it back brings them back.
 */
export async function allPlaces(userKey: string, filter: PlaceFilter = {}): Promise<Place[]> {
  const { category = null, subcategory = null, cuisine = null } = filter;
  return await sql`
    SELECT e.id, e.name, e.lat, e.lng, e.address, e.note,
           e.list_name AS "listName", e.category, e.category_source AS "categorySource",
           e.cuisine, e.cuisine_source AS "cuisineSource", e.price,
           ARRAY(SELECT s.name FROM place_subcategories s
                  WHERE s.user_key = e.user_key AND s.place_id = e.id
                    AND s.parent = e.category
                  ORDER BY s.name) AS subcategories
    FROM effective_places e
    WHERE e.user_key = ${userKey}
      AND (${category}::text IS NULL OR e.category = ${category})
      AND (${subcategory}::text IS NULL OR EXISTS (
            SELECT 1 FROM place_subcategories s
             WHERE s.user_key = e.user_key AND s.place_id = e.id
               AND s.parent = e.category AND s.name = ${subcategory}))
      AND (${cuisine}::text IS NULL OR e.cuisine = ${cuisine})`;
}
