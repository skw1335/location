import { db } from "../db";

const ownsPlace = (userKey: string, placeId: string) =>
  !!db.query(`SELECT 1 FROM places WHERE user_key = ? AND id = ? LIMIT 1`).get(userKey, placeId);

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
export const setPlaceOverride = db.transaction(
  (userKey: string, placeId: string, patch: OverridePatch): boolean => {
    if (!ownsPlace(userKey, placeId)) return false;

    const current = db
      .query(
        `SELECT category, hidden, cuisine, price FROM place_overrides
         WHERE user_key = ? AND place_id = ?`,
      )
      .get(userKey, placeId) as {
      category: string | null;
      hidden: number | null;
      cuisine: string | null;
      price: number | null;
    } | null;

    const pick = <K extends "category" | "cuisine" | "price">(key: K) =>
      patch[key] === undefined ? (current?.[key] ?? null) : patch[key];
    const hidden =
      patch.hidden === undefined ? (current?.hidden ?? null) : patch.hidden ? 1 : 0;

    db.query(
      `INSERT INTO place_overrides
         (user_key, place_id, category, hidden, cuisine, price, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_key, place_id) DO UPDATE SET
         category = excluded.category, hidden = excluded.hidden,
         cuisine = excluded.cuisine, price = excluded.price,
         updated_at = excluded.updated_at`,
    ).run(userKey, placeId, pick("category"), hidden, pick("cuisine"), pick("price"), Date.now());
    return true;
  },
);
