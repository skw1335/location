import { db } from "../db";
import { CATEGORIES, categorize } from "./categorize";

/**
 * Keeps stored categories in line with the current built-ins and keyword
 * rules. Refreshes skip unchanged lists, so without this a place categorised
 * under an old rule — or a retired category — would keep it forever. Cheap:
 * pure string matching, no network.
 */
export const rederiveKeywordCategories = db.transaction(() => {
  const rows = db
    .query(
      `SELECT p.id, p.list_url, p.user_key, p.name, l.name AS list_name
       FROM places p JOIN lists l ON l.url = p.list_url AND l.user_key = p.user_key`,
    )
    .all() as Array<{ id: string; list_url: string; user_key: string; name: string; list_name: string }>;
  const update = db.query(
    `UPDATE places SET category = ?, category_source = ?
     WHERE id = ? AND list_url = ? AND user_key = ?`,
  );
  for (const r of rows) {
    const { category, source } = categorize(r.name, r.list_name);
    update.run(category, source, r.id, r.list_url, r.user_key);
  }

  // A category the user picked that no longer exists goes back to automatic.
  const known = CATEGORIES.map(() => "?").join(", ");
  db.query(`UPDATE place_overrides SET category = NULL WHERE category NOT IN (${known})`).run(
    ...CATEGORIES,
  );
  return rows.length;
});
