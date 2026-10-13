import { sql } from "../db";
import { categoryOverview, type Subcategory } from "./overview";

/**
 * Creates a subcategory inside a built-in. Creating one that already exists is
 * a no-op, so typing it again never errors.
 */
export async function createSubcategory(
  userKey: string,
  parent: string,
  name: string,
): Promise<Subcategory> {
  await sql`
    INSERT INTO subcategories (user_key, parent, name) VALUES (${userKey}, ${parent}, ${name})
    ON CONFLICT DO NOTHING`;
  return (await categoryOverview(userKey)).subcategories.find(
    (c) => c.parent === parent && c.name === name,
  )!;
}

/** Deletes a subcategory and takes it off every place. */
export async function deleteSubcategory(
  userKey: string,
  parent: string,
  name: string,
): Promise<boolean> {
  const deleted = await sql`
    DELETE FROM subcategories
    WHERE user_key = ${userKey} AND parent = ${parent} AND name = ${name}`;
  return deleted.count > 0;
}

export type ApplyResult =
  | { ok: true }
  | { ok: false; error: "no such place" | "unknown subcategory"; names?: string[] };

/**
 * Sets exactly which subcategories a place carries, from those inside the
 * place's current category. Subcategories it holds under a *different* parent
 * — from before it was moved — are left alone for if it moves back.
 */
export const setPlaceSubcategories = (userKey: string, placeId: string, names: string[]) =>
  sql.begin(async (tx): Promise<ApplyResult> => {
    const [place] = await tx`
      SELECT category FROM effective_places
      WHERE user_key = ${userKey} AND id = ${placeId} LIMIT 1`;
    if (!place) return { ok: false, error: "no such place" };

    const known = new Set(
      (
        await tx`SELECT name FROM subcategories
                 WHERE user_key = ${userKey} AND parent = ${place.category}`
      ).map((r: { name: string }) => r.name),
    );
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length) return { ok: false, error: "unknown subcategory", names: unknown };

    await tx`
      DELETE FROM place_subcategories
      WHERE user_key = ${userKey} AND place_id = ${placeId} AND parent = ${place.category}`;
    if (names.length) {
      await tx`INSERT INTO place_subcategories ${sql(
        names.map((name) => ({ user_key: userKey, place_id: placeId, parent: place.category, name })),
      )}`;
    }
    return { ok: true };
  });
