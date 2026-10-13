import { sql } from "../db";
import { CATEGORIES, categorize } from "./categorize";

/**
 * Keeps stored categories in line with the current built-ins and keyword
 * rules. Refreshes skip unchanged lists, so without this a place categorised
 * under an old rule — or a retired category — would keep it forever. Cheap:
 * pure string matching, no network.
 */
export const rederiveKeywordCategories = () =>
  sql.begin(async (tx): Promise<number> => {
    const rows: Array<{ id: string; list_url: string; user_key: string; name: string; list_name: string }> =
      await tx`
        SELECT p.id, p.list_url, p.user_key, p.name, l.name AS list_name
        FROM places p JOIN lists l ON l.url = p.list_url AND l.user_key = p.user_key`;
    for (const r of rows) {
      const { category, source } = categorize(r.name, r.list_name);
      await tx`
        UPDATE places SET category = ${category}, category_source = ${source}
        WHERE id = ${r.id} AND list_url = ${r.list_url} AND user_key = ${r.user_key}`;
    }

    // A category the user picked that no longer exists goes back to automatic.
    await tx`UPDATE place_overrides SET category = NULL
             WHERE category NOT IN ${sql([...CATEGORIES])}`;
    return rows.length;
  });
