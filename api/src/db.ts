import { Database } from "bun:sqlite";
import { CATEGORIES, categorize } from "./categorize";
import type { IngestResult, Place, SavedList } from "./types";

const db = new Database(process.env.DB_PATH ?? "location.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/**
 * Everything is keyed by `user_key` — the opaque per-device key the app sends.
 * Every read filters on it, so a user sees exactly their own lists and nothing
 * else.
 *
 * The same share URL connected by two users is two rows: lists are cheap to
 * refetch, and keeping them separate means deleting one user never touches
 * another's data.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS lists (
    url        TEXT NOT NULL,
    user_key   TEXT NOT NULL,
    name       TEXT NOT NULL,
    strategy   TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    -- Hash of the parsed contents, so a refresh that changed nothing skips the rewrite.
    content_hash TEXT,
    PRIMARY KEY (url, user_key)
  );

  CREATE TABLE IF NOT EXISTS places (
    id              TEXT NOT NULL,
    list_url        TEXT NOT NULL,
    user_key        TEXT NOT NULL,
    name            TEXT NOT NULL,
    lat             REAL NOT NULL,
    lng             REAL NOT NULL,
    address         TEXT,
    note            TEXT,
    category        TEXT,
    category_source TEXT,
    -- Filled in automatically once something can (the categorizer, Places API).
    cuisine         TEXT,
    price           INTEGER,
    PRIMARY KEY (id, list_url, user_key),
    FOREIGN KEY (list_url, user_key) REFERENCES lists(url, user_key) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS places_by_user ON places (user_key);
`);

/**
 * Refreshing a list clears and rewrites its places, so anything the *user*
 * decided has to live outside that table or every sync would erase it.
 * Overrides are keyed by place id alone: correcting "Russ & Daughters" once
 * should hold no matter which list it later turns up in.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS place_overrides (
    user_key   TEXT NOT NULL,
    place_id   TEXT NOT NULL,
    category   TEXT,
    -- Nullable on purpose: NULL means "the user hasn't said", which is distinct
    -- from an explicit un-hide. Every read coalesces it to 0.
    hidden     INTEGER,
    cuisine    TEXT,
    price      INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, place_id)
  );
`);

/**
 * Subcategories the user makes up, always *inside* a built-in category. The
 * built-ins stay high-level ("food", "drink") and are assigned automatically;
 * what kind of restaurant a place is to *you* — "lunch special", "date spot",
 * "gatekeep this" — is personal, so the user creates those beneath one.
 *
 * Names are scoped to their parent: "date spot" under food and "date spot"
 * under drink are two different things. A subcategory exists once created,
 * whether or not any place carries it yet.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS subcategories (
    user_key   TEXT NOT NULL,
    parent     TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, parent, name)
  );

  -- Which places carry which subcategories. Kept apart from \`places\` for the
  -- same reason as overrides: a refresh must never erase them.
  CREATE TABLE IF NOT EXISTS place_subcategories (
    user_key   TEXT NOT NULL,
    place_id   TEXT NOT NULL,
    parent     TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_key, place_id, parent, name),
    FOREIGN KEY (user_key, parent, name)
      REFERENCES subcategories(user_key, parent, name) ON DELETE CASCADE
  );
`);

/**
 * What Google Maps calls each place, looked up in the background (see
 * enrich/). Kept out of \`places\` because refreshes rewrite that table, and
 * not per user: it's public fact about the place, so one lookup serves
 * everyone who saved it.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS place_lookups (
    place_id          TEXT PRIMARY KEY,
    -- matched | no_match | error — decides when to try again.
    status            TEXT NOT NULL,
    google_id         TEXT,
    -- Google's own categories, kept raw so mapping changes can be re-derived
    -- without refetching (see rederiveLookups).
    google_categories TEXT,
    category          TEXT,
    cuisine           TEXT,
    checked_at        INTEGER NOT NULL
  );
`);

/** Columns added after a table first shipped, backfilled onto existing databases. */
function ensureColumns(table: string, columns: Record<string, string>) {
  const have = new Set(
    (db.query(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  for (const [name, type] of Object.entries(columns)) {
    if (!have.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
}
ensureColumns("places", { cuisine: "TEXT", price: "INTEGER" });
ensureColumns("place_overrides", { cuisine: "TEXT", price: "INTEGER" });
ensureColumns("place_lookups", { category: "TEXT" });

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

/** What to narrow the list to. Every filter is optional and they combine. */
export interface PlaceFilter {
  category?: string;
  /** A subcategory of `category`; meaningless without it. */
  subcategory?: string;
  cuisine?: string;
}

/**
 * Each place's effective values. Most personal wins: the user's override, then
 * what Google Maps says, then our keyword guess.
 *
 * A cuisine makes a place food — Tibetan means restaurant, whatever the name
 * suggests — so a cuisine the user set outranks everything but an explicit
 * category of theirs. (Google's cuisine already implies its category.)
 */
const EFFECTIVE = `
  SELECT p.*, l.name AS list_name,
         COALESCE(o.category,
                  CASE WHEN o.cuisine IS NOT NULL THEN 'food' END,
                  g.category, p.category) AS eff_category,
         CASE WHEN o.category IS NOT NULL OR o.cuisine IS NOT NULL THEN 'override'
              WHEN g.category IS NOT NULL THEN 'google'
              ELSE p.category_source END AS eff_source,
         COALESCE(o.cuisine, g.cuisine, p.cuisine) AS eff_cuisine,
         CASE WHEN o.cuisine IS NOT NULL THEN 'override'
              WHEN g.cuisine IS NOT NULL THEN 'google'
              WHEN p.cuisine IS NOT NULL THEN 'derived' END AS eff_cuisine_source,
         COALESCE(o.price, p.price) AS eff_price
  FROM places p
  JOIN lists l ON l.url = p.list_url AND l.user_key = p.user_key
  LEFT JOIN place_overrides o ON o.user_key = p.user_key AND o.place_id = p.id
  LEFT JOIN place_lookups g ON g.place_id = p.id AND g.status = 'matched'
  WHERE p.user_key = ?1 AND COALESCE(o.hidden, 0) = 0`;

/**
 * A place's subcategories only count while it sits in their parent. Moving a
 * place from food to drink hides its food subcategories rather than deleting
 * them, so moving it back brings them back.
 */
const ACTIVE_SUB = `
  s.user_key = e.user_key AND s.place_id = e.id AND s.parent = e.eff_category`;

/**
 * Every place across every list the user has connected.
 *
 * The user's overrides outrank anything derived, and hidden places never leave
 * the server at all. Filtering happens here rather than on the phone so the
 * client only ever receives what it's about to draw.
 */
export function allPlaces(userKey: string, filter: PlaceFilter = {}): Place[] {
  const { category = null, subcategory = null, cuisine = null } = filter;
  const rows = db
    .query(
      `SELECT e.id, e.name, e.lat, e.lng, e.address, e.note,
              e.list_name AS listName, e.eff_category AS category,
              e.eff_source AS categorySource, e.eff_cuisine AS cuisine,
              e.eff_cuisine_source AS cuisineSource, e.eff_price AS price,
              (SELECT json_group_array(name) FROM
                 (SELECT name FROM place_subcategories s WHERE ${ACTIVE_SUB}
                   ORDER BY name)) AS subcategories
       FROM (${EFFECTIVE}) e
       WHERE (?2 IS NULL OR e.eff_category = ?2)
         AND (?3 IS NULL OR EXISTS (SELECT 1 FROM place_subcategories s
                WHERE ${ACTIVE_SUB} AND s.name = ?3))
         AND (?4 IS NULL OR e.eff_cuisine = ?4)`,
    )
    .all(userKey, category, subcategory, cuisine) as Array<
    Omit<Place, "subcategories"> & { subcategories: string }
  >;
  return rows.map((r) => ({ ...r, subcategories: JSON.parse(r.subcategories) as string[] }));
}

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

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long each outcome stands before the place is looked up again. Matches
 * rarely change; a miss may be a place Google hadn't indexed yet; an error is
 * usually transient.
 */
const RECHECK_AFTER = { matched: 90 * DAY, no_match: 30 * DAY, error: 1 * DAY };

/** Places, across all users, that have never been looked up or are due again. */
export function placesToLookUp(
  limit: number,
  now = Date.now(),
): Array<{ id: string; name: string; lat: number; lng: number }> {
  return db
    .query(
      `SELECT p.id, MIN(p.name) AS name, MIN(p.lat) AS lat, MIN(p.lng) AS lng
       FROM places p
       LEFT JOIN place_lookups g ON g.place_id = p.id
       WHERE g.place_id IS NULL
          OR (g.status = 'matched'  AND g.checked_at < ?1)
          OR (g.status = 'no_match' AND g.checked_at < ?2)
          OR (g.status = 'error'    AND g.checked_at < ?3)
       GROUP BY p.id
       ORDER BY g.checked_at IS NOT NULL, g.checked_at
       LIMIT ?4`,
    )
    .all(
      now - RECHECK_AFTER.matched,
      now - RECHECK_AFTER.no_match,
      now - RECHECK_AFTER.error,
      limit,
    ) as Array<{ id: string; name: string; lat: number; lng: number }>;
}

export function saveLookup(
  placeId: string,
  lookup:
    | {
        status: "matched";
        googleId: string | null;
        googleCategories: string[];
        category: string | null;
        cuisine: string | null;
      }
    | { status: "no_match" | "error" },
  now = Date.now(),
) {
  const m = lookup.status === "matched" ? lookup : null;
  db.query(
    `INSERT OR REPLACE INTO place_lookups
       (place_id, status, google_id, google_categories, category, cuisine, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    placeId,
    lookup.status,
    m?.googleId ?? null,
    m ? JSON.stringify(m.googleCategories) : null,
    m?.category ?? null,
    m?.cuisine ?? null,
    now,
  );
}

/**
 * Recomputes category and cuisine for every matched lookup from the Google
 * categories already stored. Run at startup, so a change to the mapping rules
 * applies to everything without a single new request to Google.
 */
export const rederiveLookups = db.transaction(
  (derive: (googleCategories: string[]) => { category: string | null; cuisine: string | null }) => {
    const rows = db
      .query(`SELECT place_id, google_categories FROM place_lookups WHERE status = 'matched'`)
      .all() as Array<{ place_id: string; google_categories: string | null }>;
    const update = db.query(`UPDATE place_lookups SET category = ?, cuisine = ? WHERE place_id = ?`);
    for (const row of rows) {
      const { category, cuisine } = derive(JSON.parse(row.google_categories ?? "[]"));
      update.run(category, cuisine, row.place_id);
    }
    return rows.length;
  },
);

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

/** Deletes everything held for a user — lists, places, overrides, subcategories. */
export const forgetUser = db.transaction((userKey: string) => {
  db.query(`DELETE FROM lists WHERE user_key = ?`).run(userKey);
  db.query(`DELETE FROM place_overrides WHERE user_key = ?`).run(userKey);
  db.query(`DELETE FROM subcategories WHERE user_key = ?`).run(userKey);
});
