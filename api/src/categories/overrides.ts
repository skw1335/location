import { sql } from "../db";

export interface OverridePatch {
  category?: string | null;
  hidden?: boolean;
  cuisine?: string | null;
  price?: number | null;
}

/**
 * Records a manual correction. Returns false when the place isn't in any of the
 * user's lists, so nobody can plant overrides for places they don't have.
 *
 * In `patch`, a missing field means "leave as is", and `null` clears the
 * user's value so the automatic one shows through again.
 */
export const setPlaceOverride = (userKey: string, placeId: string, patch: OverridePatch) =>
  sql.begin(async (tx): Promise<boolean> => {
    const [owned] = await tx`
      SELECT 1 FROM places WHERE user_key = ${userKey} AND id = ${placeId} LIMIT 1`;
    if (!owned) return false;

    const [current] = await tx`
      SELECT category, hidden, cuisine, price FROM place_overrides
      WHERE user_key = ${userKey} AND place_id = ${placeId}`;

    const pick = <K extends "category" | "hidden" | "cuisine" | "price">(key: K) =>
      patch[key] === undefined ? (current?.[key] ?? null) : patch[key];

    await tx`
      INSERT INTO place_overrides (user_key, place_id, category, hidden, cuisine, price, updated_at)
      VALUES (${userKey}, ${placeId}, ${pick("category")}, ${pick("hidden")}, ${pick("cuisine")},
              ${pick("price")}, now())
      ON CONFLICT (user_key, place_id) DO UPDATE SET
        category = excluded.category, hidden = excluded.hidden,
        cuisine = excluded.cuisine, price = excluded.price,
        updated_at = excluded.updated_at`;
    return true;
  });
