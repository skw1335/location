import { db } from "../db";
import { categorize } from "../categories/categorize";
import type { IngestResult, SavedList } from "../types";

const upsertList = db.query(
  `INSERT INTO lists (url, user_key, name, strategy, fetched_at, content_hash)
   VALUES (?, ?, ?, ?, ?, ?)
   ON CONFLICT(url, user_key) DO UPDATE SET name = excluded.name,
     strategy = excluded.strategy, fetched_at = excluded.fetched_at,
     content_hash = excluded.content_hash`,
);
const touchList = db.query(
  `UPDATE lists SET fetched_at = ?, strategy = ? WHERE url = ? AND user_key = ?`,
);
const listHash = db.query(`SELECT content_hash FROM lists WHERE url = ? AND user_key = ?`);
const clearPlaces = db.query(`DELETE FROM places WHERE list_url = ? AND user_key = ?`);
const insertPlace = db.query(
  `INSERT OR REPLACE INTO places
     (id, list_url, user_key, name, lat, lng, address, note, category, category_source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const hashOf = (result: IngestResult) =>
  Bun.hash(JSON.stringify([result.listName, result.places])).toString(16);

/**
 * Replaces a list's cached contents wholesale — lists are small, diffing isn't
 * worth it. Returns whether anything actually changed; an identical refetch
 * only bumps `fetched_at`.
 */
export const saveList = db.transaction(
  (url: string, userKey: string, result: IngestResult): boolean => {
    const hash = hashOf(result);
    const existing = listHash.get(url, userKey) as { content_hash: string | null } | null;
    if (existing?.content_hash === hash) {
      touchList.run(result.fetchedAt, result.strategy, url, userKey);
      return false;
    }

    upsertList.run(url, userKey, result.listName, result.strategy, result.fetchedAt, hash);
    clearPlaces.run(url, userKey);
    for (const p of result.places) {
      // Derived here rather than in the parser: categorisation is our judgement
      // about a place, not something the source told us.
      const { category, source } = categorize(p.name, result.listName);
      insertPlace.run(
        p.id,
        url,
        userKey,
        p.name,
        p.lat,
        p.lng,
        p.address ?? null,
        p.note ?? null,
        category,
        source,
      );
    }
    return true;
  },
);

/** Lists fetched longer ago than `olderThanMs`, with how many places each holds now. */
export function staleLists(
  userKey: string,
  olderThanMs: number,
): Array<{ url: string; count: number }> {
  return db
    .query(
      `SELECT l.url,
              (SELECT COUNT(*) FROM places p
                WHERE p.list_url = l.url AND p.user_key = l.user_key) AS count
       FROM lists l
       WHERE l.user_key = ? AND l.fetched_at < ?`,
    )
    .all(userKey, Date.now() - olderThanMs) as Array<{ url: string; count: number }>;
}

export function listAge(url: string, userKey: string): number | null {
  const row = db
    .query(`SELECT fetched_at FROM lists WHERE url = ? AND user_key = ?`)
    .get(url, userKey) as { fetched_at: number } | undefined;
  return row ? Date.now() - row.fetched_at : null;
}

export function savedLists(userKey: string): SavedList[] {
  return db
    .query(
      `SELECT l.url, l.name,
              (SELECT COUNT(*) FROM places p
                WHERE p.list_url = l.url AND p.user_key = l.user_key) AS count
       FROM lists l
       WHERE l.user_key = ?
       ORDER BY l.name`,
    )
    .all(userKey) as SavedList[];
}
