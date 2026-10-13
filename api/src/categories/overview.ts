import { sql } from "../db";

export interface Count {
  name: string;
  count: number;
}

export interface Subcategory extends Count {
  /** The built-in category it sits inside. */
  parent: string;
}

/**
 * Everything the filter chips and the edit sheet need, in one read. Counts are
 * of distinct places — a place saved in two lists counts once.
 */
export async function categoryOverview(userKey: string): Promise<{
  builtIn: Count[];
  subcategories: Subcategory[];
  cuisines: Count[];
}> {
  const distinct = sql`
    (SELECT DISTINCT user_key, id, category, cuisine FROM effective_places
      WHERE user_key = ${userKey})`;

  const [builtIn, subcategories, cuisines] = await Promise.all([
    sql`SELECT category AS name, COUNT(*)::int AS count FROM ${distinct} e
        GROUP BY 1 ORDER BY count DESC, name`,
    // Every subcategory, even unused ones — the user made them on purpose.
    sql`SELECT k.parent, k.name,
               (SELECT COUNT(*)::int FROM ${distinct} e
                  JOIN place_subcategories s
                    ON s.user_key = e.user_key AND s.place_id = e.id AND s.parent = e.category
                 WHERE s.parent = k.parent AND s.name = k.name) AS count
        FROM subcategories k
        WHERE k.user_key = ${userKey}
        ORDER BY k.parent, count DESC, k.name`,
    sql`SELECT cuisine AS name, COUNT(*)::int AS count FROM ${distinct} e
        WHERE cuisine IS NOT NULL GROUP BY 1 ORDER BY count DESC, name`,
  ]);
  return { builtIn, subcategories, cuisines };
}
