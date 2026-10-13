import { Database } from "bun:sqlite";

export const db = new Database(process.env.DB_PATH ?? "location.sqlite", { create: true });
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
 * categories/google/). Kept out of \`places\` because refreshes rewrite that table, and
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

/** Deletes everything held for a user — lists, places, overrides, subcategories. */
export const forgetUser = db.transaction((userKey: string) => {
  db.query(`DELETE FROM lists WHERE user_key = ?`).run(userKey);
  db.query(`DELETE FROM place_overrides WHERE user_key = ?`).run(userKey);
  db.query(`DELETE FROM subcategories WHERE user_key = ?`).run(userKey);
});
