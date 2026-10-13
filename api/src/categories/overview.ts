import { db } from "../db";
import { ACTIVE_SUB, EFFECTIVE } from "./effective";

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
export function categoryOverview(userKey: string): {
  builtIn: Count[];
  subcategories: Subcategory[];
  cuisines: Count[];
} {
  const distinct = `SELECT DISTINCT user_key, id, eff_category, eff_cuisine FROM (${EFFECTIVE})`;

  const builtIn = db
    .query(
      `SELECT eff_category AS name, COUNT(*) AS count FROM (${distinct})
       GROUP BY 1 ORDER BY count DESC, name`,
    )
    .all(userKey) as Count[];

  // Every subcategory, even unused ones — the user made them on purpose.
  const subcategories = db
    .query(
      `SELECT k.parent, k.name,
              (SELECT COUNT(*) FROM (${distinct}) e
                 JOIN place_subcategories s ON ${ACTIVE_SUB}
                WHERE s.parent = k.parent AND s.name = k.name) AS count
       FROM subcategories k
       WHERE k.user_key = ?1
       ORDER BY k.parent, count DESC, k.name`,
    )
    .all(userKey) as Subcategory[];

  const cuisines = db
    .query(
      `SELECT eff_cuisine AS name, COUNT(*) AS count FROM (${distinct})
       WHERE eff_cuisine IS NOT NULL GROUP BY 1 ORDER BY count DESC, name`,
    )
    .all(userKey) as Count[];

  return { builtIn, subcategories, cuisines };
}
