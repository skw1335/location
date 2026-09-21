import { Database } from "bun:sqlite";
import { categorize, type Category } from "./categorize";
import type { Group, IngestResult, Place, SavedList } from "./types";

const db = new Database(process.env.DB_PATH ?? "location.sqlite", { create: true });
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

/**
 * Lists belong to a *group*, never directly to a person, and a solo user is
 * simply a group of one. That keeps sharing from becoming a second code path:
 * "my places" and "our places" are the same query, and turning a personal list
 * into a shared one is a membership row, not a migration.
 *
 * Reads are always reached through `group_members`, so a user sees exactly the
 * groups they belong to and nothing else.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS groups (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    personal    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id  TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_key  TEXT NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, user_key)
  );

  CREATE TABLE IF NOT EXISTS lists (
    url        TEXT NOT NULL,
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    strategy   TEXT NOT NULL,
    fetched_at INTEGER NOT NULL,
    PRIMARY KEY (url, group_id)
  );

  CREATE TABLE IF NOT EXISTS places (
    id       TEXT NOT NULL,
    list_url TEXT NOT NULL,
    group_id TEXT NOT NULL,
    name     TEXT NOT NULL,
    lat      REAL NOT NULL,
    lng      REAL NOT NULL,
    address  TEXT,
    note     TEXT,
    PRIMARY KEY (id, list_url, group_id),
    FOREIGN KEY (list_url, group_id) REFERENCES lists(url, group_id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS members_by_user ON group_members (user_key);
  CREATE INDEX IF NOT EXISTS places_by_group ON places (group_id);
`);

/**
 * Refreshing a list clears and rewrites its places, so anything the *user*
 * decided has to live outside that table or every sync would erase it.
 * Overrides are keyed by place id alone: correcting "Russ & Daughters" once
 * should hold no matter which list it later turns up in.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS place_overrides (
    group_id   TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    place_id   TEXT NOT NULL,
    category   TEXT,
    -- Nullable on purpose: NULL means "the user hasn't said", which is distinct
    -- from an explicit un-hide. Every read coalesces it to 0.
    hidden     INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (group_id, place_id)
  );
`);

/** Added after the first release, so existing databases need it backfilled. */
const placeColumns = new Set(
  (db.query(`PRAGMA table_info(places)`).all() as Array<{ name: string }>).map((c) => c.name),
);
if (!placeColumns.has("category")) {
  db.exec(`ALTER TABLE places ADD COLUMN category TEXT`);
}
if (!placeColumns.has("category_source")) {
  db.exec(`ALTER TABLE places ADD COLUMN category_source TEXT`);
}

/**
 * Invite codes get read aloud and typed by hand, so the alphabet drops the
 * characters people confuse: no O/0, no I/1/L.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function mintInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

const insertGroup = db.query(
  `INSERT INTO groups (id, name, invite_code, personal, created_at)
   VALUES (?, ?, ?, ?, ?)`,
);
const addMember = db.query(
  `INSERT OR IGNORE INTO group_members (group_id, user_key, joined_at) VALUES (?, ?, ?)`,
);

/** Creates a group and puts the creator in it. */
export const createGroup = db.transaction(
  (userKey: string, name: string, personal = false): Group => {
    const id = crypto.randomUUID();
    const inviteCode = mintInviteCode();
    insertGroup.run(id, name, inviteCode, personal ? 1 : 0, Date.now());
    addMember.run(id, userKey, Date.now());
    return { id, name, inviteCode, members: 1, personal };
  },
);

/**
 * Every user has exactly one personal group, made on first contact. Callers can
 * therefore assume a destination for a list without asking where to put it.
 */
export function personalGroup(userKey: string): Group {
  const row = db
    .query(
      `SELECT g.id, g.name, g.invite_code FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.user_key = ? AND g.personal = 1 LIMIT 1`,
    )
    .get(userKey) as { id: string; name: string; invite_code: string } | undefined;

  if (row) {
    return {
      id: row.id,
      name: row.name,
      inviteCode: row.invite_code,
      members: 1,
      personal: true,
    };
  }
  return createGroup(userKey, "My places", true);
}

export function isMember(userKey: string, groupId: string): boolean {
  return !!db
    .query(`SELECT 1 FROM group_members WHERE user_key = ? AND group_id = ?`)
    .get(userKey, groupId);
}

/** Returns the joined group, or null when the code matches nothing. */
export function joinByInvite(userKey: string, inviteCode: string): Group | null {
  const row = db
    .query(`SELECT id, name FROM groups WHERE invite_code = ? AND personal = 0`)
    .get(inviteCode.toUpperCase().trim()) as { id: string; name: string } | undefined;
  if (!row) return null;

  addMember.run(row.id, userKey, Date.now());
  return {
    id: row.id,
    name: row.name,
    inviteCode: inviteCode.toUpperCase().trim(),
    members: memberCount(row.id),
    personal: false,
  };
}

const memberCount = (groupId: string): number =>
  (
    db
      .query(`SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?`)
      .get(groupId) as { n: number }
  ).n;

export function groupsFor(userKey: string): Group[] {
  return db
    .query(
      `SELECT g.id, g.name, g.invite_code AS inviteCode, g.personal,
              (SELECT COUNT(*) FROM group_members m2 WHERE m2.group_id = g.id) AS members
       FROM groups g
       JOIN group_members m ON m.group_id = g.id
       WHERE m.user_key = ?
       ORDER BY g.personal DESC, g.name`,
    )
    .all(userKey)
    .map((r) => {
      const row = r as Omit<Group, "personal"> & { personal: number };
      return { ...row, personal: !!row.personal };
    });
}

const upsertList = db.query(
  `INSERT INTO lists (url, group_id, name, strategy, fetched_at) VALUES (?, ?, ?, ?, ?)
   ON CONFLICT(url, group_id) DO UPDATE SET name = excluded.name,
     strategy = excluded.strategy, fetched_at = excluded.fetched_at`,
);
const clearPlaces = db.query(`DELETE FROM places WHERE list_url = ? AND group_id = ?`);
const insertPlace = db.query(
  `INSERT OR REPLACE INTO places
     (id, list_url, group_id, name, lat, lng, address, note, category, category_source)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

/** Replaces a list's cached contents wholesale — lists are small, diffing isn't worth it. */
export const saveList = db.transaction(
  (url: string, groupId: string, result: IngestResult) => {
    upsertList.run(url, groupId, result.listName, result.strategy, result.fetchedAt);
    clearPlaces.run(url, groupId);
    for (const p of result.places) {
      // Derived here rather than in the parser: categorisation is our judgement
      // about a place, not something the source told us.
      const { category, source } = categorize(p.name, result.listName);
      insertPlace.run(
        p.id,
        url,
        groupId,
        p.name,
        p.lat,
        p.lng,
        p.address ?? null,
        p.note ?? null,
        category,
        source,
      );
    }
  },
);

/**
 * Freshness is a property of the list, not of who's asking — if a groupmate
 * refreshed a minute ago, everyone else gets to skip the fetch.
 */
export function listAge(url: string, groupId: string): number | null {
  const row = db
    .query(`SELECT fetched_at FROM lists WHERE url = ? AND group_id = ?`)
    .get(url, groupId) as { fetched_at: number } | undefined;
  return row ? Date.now() - row.fetched_at : null;
}

/**
 * Every place across every group the user belongs to.
 *
 * A user's override outranks the derived category, and hidden places never
 * leave the server at all. Filtering happens here rather than on the phone so
 * the client only ever receives what it's about to draw.
 */
export function allPlaces(userKey: string, category?: Category): Place[] {
  return db
    .query(
      `SELECT p.id, p.name, p.lat, p.lng, p.address, p.note,
              l.name AS listName,
              COALESCE(o.category, p.category) AS category,
              CASE WHEN o.category IS NOT NULL THEN 'override'
                   ELSE p.category_source END AS categorySource
       FROM places p
       JOIN lists l ON l.url = p.list_url AND l.group_id = p.group_id
       JOIN group_members m ON m.group_id = p.group_id
       LEFT JOIN place_overrides o
              ON o.group_id = p.group_id AND o.place_id = p.id
       WHERE m.user_key = ?
         AND COALESCE(o.hidden, 0) = 0
         AND (? IS NULL OR COALESCE(o.category, p.category) = ?)`,
    )
    .all(userKey, category ?? null, category ?? null) as Place[];
}

/** Distinct categories present in the user's places, with counts, for filter chips. */
export function categoryCounts(userKey: string): Array<{ category: string; count: number }> {
  return db
    .query(
      `SELECT COALESCE(o.category, p.category) AS category, COUNT(*) AS count
       FROM places p
       JOIN group_members m ON m.group_id = p.group_id
       LEFT JOIN place_overrides o
              ON o.group_id = p.group_id AND o.place_id = p.id
       WHERE m.user_key = ? AND COALESCE(o.hidden, 0) = 0
       GROUP BY 1
       ORDER BY count DESC, category`,
    )
    .all(userKey) as Array<{ category: string; count: number }>;
}

/**
 * Records a manual correction. Applies to every group the user belongs to that
 * actually holds the place, so a fix follows the place rather than a listing.
 */
export function setPlaceOverride(
  userKey: string,
  placeId: string,
  patch: { category?: Category; hidden?: boolean },
): number {
  const groups = db
    .query(
      `SELECT DISTINCT p.group_id AS id FROM places p
       JOIN group_members m ON m.group_id = p.group_id
       WHERE m.user_key = ? AND p.id = ?`,
    )
    .all(userKey, placeId) as Array<{ id: string }>;

  for (const g of groups) {
    db.query(
      `INSERT INTO place_overrides (group_id, place_id, category, hidden, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(group_id, place_id) DO UPDATE SET
         category = COALESCE(excluded.category, place_overrides.category),
         hidden   = COALESCE(excluded.hidden, place_overrides.hidden),
         updated_at = excluded.updated_at`,
    ).run(g.id, placeId, patch.category ?? null, patch.hidden === undefined ? null : patch.hidden ? 1 : 0, Date.now());
  }
  return groups.length;
}

export function savedLists(userKey: string): SavedList[] {
  return db
    .query(
      `SELECT l.url, l.name, g.name AS groupName, g.personal,
              (SELECT COUNT(*) FROM places p
                WHERE p.list_url = l.url AND p.group_id = l.group_id) AS count
       FROM lists l
       JOIN groups g ON g.id = l.group_id
       JOIN group_members m ON m.group_id = l.group_id
       WHERE m.user_key = ?
       ORDER BY g.personal DESC, g.name, l.name`,
    )
    .all(userKey)
    .map((r) => {
      const row = r as Omit<SavedList, "shared"> & { personal: number };
      return { ...row, shared: !row.personal };
    });
}

/**
 * Forgetting a user drops their personal groups outright, but only removes
 * their membership from shared ones — deleting your account shouldn't delete
 * everyone else's places.
 */
export const forgetUser = db.transaction((userKey: string) => {
  db.query(
    `DELETE FROM groups WHERE personal = 1 AND id IN
       (SELECT group_id FROM group_members WHERE user_key = ?)`,
  ).run(userKey);
  db.query(`DELETE FROM group_members WHERE user_key = ?`).run(userKey);
});
