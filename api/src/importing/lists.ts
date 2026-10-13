import { sql } from "../db";
import { categorize } from "../categories/categorize";
import type { IngestResult, SavedList } from "../types";

const hashOf = (result: IngestResult) =>
  Bun.hash(JSON.stringify([result.listName, result.places])).toString(16);

/**
 * Replaces a list's cached contents wholesale — lists are small, diffing isn't
 * worth it. Returns whether anything actually changed; an identical refetch
 * only bumps `fetched_at`.
 */
export const saveList = (url: string, userKey: string, result: IngestResult) =>
  sql.begin(async (tx): Promise<boolean> => {
    const hash = hashOf(result);
    const fetchedAt = new Date(result.fetchedAt);
    const [existing] = await tx`
      SELECT content_hash FROM lists WHERE url = ${url} AND user_key = ${userKey}`;
    if (existing?.content_hash === hash) {
      await tx`UPDATE lists SET fetched_at = ${fetchedAt}, strategy = ${result.strategy}
               WHERE url = ${url} AND user_key = ${userKey}`;
      return false;
    }

    await tx`
      INSERT INTO lists (url, user_key, name, strategy, fetched_at, content_hash)
      VALUES (${url}, ${userKey}, ${result.listName}, ${result.strategy}, ${fetchedAt}, ${hash})
      ON CONFLICT (url, user_key) DO UPDATE SET name = excluded.name,
        strategy = excluded.strategy, fetched_at = excluded.fetched_at,
        content_hash = excluded.content_hash`;
    await tx`DELETE FROM places WHERE list_url = ${url} AND user_key = ${userKey}`;

    // A list can hold the same place twice; the last copy wins, as it did with
    // INSERT OR REPLACE.
    const rows = new Map(
      result.places.map((p) => {
        // Derived here rather than in the parser: categorisation is our
        // judgement about a place, not something the source told us.
        const { category, source } = categorize(p.name, result.listName);
        return [
          p.id,
          {
            id: p.id,
            list_url: url,
            user_key: userKey,
            name: p.name,
            lat: p.lat,
            lng: p.lng,
            address: p.address ?? null,
            note: p.note ?? null,
            category,
            category_source: source,
          },
        ];
      }),
    );
    if (rows.size) await tx`INSERT INTO places ${sql([...rows.values()])}`;
    return true;
  });

/** Lists fetched longer ago than `olderThanMs`, with how many places each holds now. */
export async function staleLists(
  userKey: string,
  olderThanMs: number,
): Promise<Array<{ url: string; count: number }>> {
  return await sql`
    SELECT l.url,
           (SELECT COUNT(*)::int FROM places p
             WHERE p.list_url = l.url AND p.user_key = l.user_key) AS count
    FROM lists l
    WHERE l.user_key = ${userKey} AND l.fetched_at < ${new Date(Date.now() - olderThanMs)}`;
}

export async function listAge(url: string, userKey: string): Promise<number | null> {
  const [row] = await sql`
    SELECT fetched_at FROM lists WHERE url = ${url} AND user_key = ${userKey}`;
  return row ? Date.now() - (row.fetched_at as Date).getTime() : null;
}

export async function savedLists(userKey: string): Promise<SavedList[]> {
  return await sql`
    SELECT l.url, l.name,
           (SELECT COUNT(*)::int FROM places p
             WHERE p.list_url = l.url AND p.user_key = l.user_key) AS count
    FROM lists l
    WHERE l.user_key = ${userKey}
    ORDER BY l.name`;
}
