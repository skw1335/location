import { db } from "../db";
import { EFFECTIVE } from "./effective";
import { categoryOverview, type Subcategory } from "./overview";

/**
 * Creates a subcategory inside a built-in. Creating one that already exists is
 * a no-op, so typing it again never errors.
 */
export function createSubcategory(userKey: string, parent: string, name: string): Subcategory {
  db.query(
    `INSERT OR IGNORE INTO subcategories (user_key, parent, name, created_at) VALUES (?, ?, ?, ?)`,
  ).run(userKey, parent, name, Date.now());
  return categoryOverview(userKey).subcategories.find(
    (c) => c.parent === parent && c.name === name,
  )!;
}

/** Deletes a subcategory and takes it off every place. */
export function deleteSubcategory(userKey: string, parent: string, name: string): boolean {
  return (
    db
      .query(`DELETE FROM subcategories WHERE user_key = ? AND parent = ? AND name = ?`)
      .run(userKey, parent, name).changes > 0
  );
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; error: "no such place" | "unknown subcategory"; names?: string[] };

/**
 * Sets exactly which subcategories a place carries, from those inside the
 * place's current category. Subcategories it holds under a *different* parent
 * — from before it was moved — are left alone for if it moves back.
 */
export const setPlaceSubcategories = db.transaction(
  (userKey: string, placeId: string, names: string[]): ApplyResult => {
    const place = db
      .query(`SELECT eff_category AS category FROM (${EFFECTIVE}) WHERE id = ?2 LIMIT 1`)
      .get(userKey, placeId) as { category: string } | null;
    if (!place) return { ok: false, error: "no such place" };

    const known = new Set(
      (
        db
          .query(`SELECT name FROM subcategories WHERE user_key = ? AND parent = ?`)
          .all(userKey, place.category) as Array<{ name: string }>
      ).map((r) => r.name),
    );
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length) return { ok: false, error: "unknown subcategory", names: unknown };

    db.query(
      `DELETE FROM place_subcategories WHERE user_key = ? AND place_id = ? AND parent = ?`,
    ).run(userKey, placeId, place.category);
    const insert = db.query(
      `INSERT INTO place_subcategories (user_key, place_id, parent, name, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const name of names) insert.run(userKey, placeId, place.category, name, Date.now());
    return { ok: true };
  },
);
