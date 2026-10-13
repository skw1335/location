-- Applied at startup and by the tests. Idempotent: safe to run against an
-- existing database. Moves to real migrations once the schema settles.

/*
 * Everything is keyed by `user_key` — the opaque per-device key the app sends.
 * Every read filters on it, so a user sees exactly their own lists and nothing
 * else.
 *
 * The same share URL connected by two users is two rows: lists are cheap to
 * refetch, and keeping them separate means deleting one user never touches
 * another's data.
 */
CREATE TABLE IF NOT EXISTS lists (
  url          TEXT NOT NULL,
  user_key     TEXT NOT NULL,
  name         TEXT NOT NULL,
  strategy     TEXT NOT NULL,
  fetched_at   TIMESTAMPTZ NOT NULL,
  -- Hash of the parsed contents, so a refresh that changed nothing skips the rewrite.
  content_hash TEXT,
  PRIMARY KEY (url, user_key)
);

CREATE TABLE IF NOT EXISTS places (
  id              TEXT NOT NULL,
  list_url        TEXT NOT NULL,
  user_key        TEXT NOT NULL,
  name            TEXT NOT NULL,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  address         TEXT,
  note            TEXT,
  category        TEXT,
  category_source TEXT,
  -- Filled in automatically once something can (the categorizer, Places API).
  cuisine         TEXT,
  price           SMALLINT,
  PRIMARY KEY (id, list_url, user_key),
  FOREIGN KEY (list_url, user_key) REFERENCES lists (url, user_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS places_by_user ON places (user_key);

/*
 * Refreshing a list clears and rewrites its places, so anything the *user*
 * decided has to live outside that table or every sync would erase it.
 * Overrides are keyed by place id alone: correcting "Russ & Daughters" once
 * should hold no matter which list it later turns up in.
 */
CREATE TABLE IF NOT EXISTS place_overrides (
  user_key   TEXT NOT NULL,
  place_id   TEXT NOT NULL,
  category   TEXT,
  -- NULL means "the user hasn't said", which is distinct from an explicit
  -- un-hide. Every read coalesces it to false.
  hidden     BOOLEAN,
  cuisine    TEXT,
  price      SMALLINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, place_id)
);

/*
 * Subcategories the user makes up, always *inside* a built-in category. The
 * built-ins stay high-level ("food", "drink") and are assigned automatically;
 * what kind of restaurant a place is to *you* — "lunch special", "date spot",
 * "gatekeep this" — is personal, so the user creates those beneath one.
 *
 * Names are scoped to their parent: "date spot" under food and "date spot"
 * under drink are two different things. A subcategory exists once created,
 * whether or not any place carries it yet.
 */
CREATE TABLE IF NOT EXISTS subcategories (
  user_key   TEXT NOT NULL,
  parent     TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, parent, name)
);

-- Which places carry which subcategories. Kept apart from `places` for the
-- same reason as overrides: a refresh must never erase them.
CREATE TABLE IF NOT EXISTS place_subcategories (
  user_key   TEXT NOT NULL,
  place_id   TEXT NOT NULL,
  parent     TEXT NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_key, place_id, parent, name),
  FOREIGN KEY (user_key, parent, name)
    REFERENCES subcategories (user_key, parent, name) ON DELETE CASCADE
);

/*
 * What Google Maps calls each place, looked up in the background (see
 * categories/google/). Kept out of `places` because refreshes rewrite that
 * table, and not per user: it's public fact about the place, so one lookup
 * serves everyone who saved it.
 */
CREATE TABLE IF NOT EXISTS place_lookups (
  place_id          TEXT PRIMARY KEY,
  -- matched | no_match | error — decides when to try again.
  status            TEXT NOT NULL,
  google_id         TEXT,
  -- Google's own categories, kept raw so mapping changes can be re-derived
  -- without refetching (see rederiveLookups).
  google_categories JSONB,
  category          TEXT,
  cuisine           TEXT,
  checked_at        TIMESTAMPTZ NOT NULL
);

/*
 * Each place's effective values. Most personal wins: the user's override, then
 * what Google Maps says, then our keyword guess.
 *
 * A cuisine makes a place food — Tibetan means restaurant, whatever the name
 * suggests — so a cuisine the user set outranks everything but an explicit
 * category of theirs. (Google's cuisine already implies its category.)
 *
 * Hidden places are left out here, so nothing downstream can leak them.
 */
CREATE OR REPLACE VIEW effective_places AS
SELECT p.id, p.user_key, p.list_url, p.name, p.lat, p.lng, p.address, p.note,
       l.name AS list_name,
       COALESCE(o.category,
                CASE WHEN o.cuisine IS NOT NULL THEN 'food' END,
                g.category, p.category) AS category,
       CASE WHEN o.category IS NOT NULL OR o.cuisine IS NOT NULL THEN 'override'
            WHEN g.category IS NOT NULL THEN 'google'
            ELSE p.category_source END AS category_source,
       COALESCE(o.cuisine, g.cuisine, p.cuisine) AS cuisine,
       CASE WHEN o.cuisine IS NOT NULL THEN 'override'
            WHEN g.cuisine IS NOT NULL THEN 'google'
            WHEN p.cuisine IS NOT NULL THEN 'derived' END AS cuisine_source,
       COALESCE(o.price, p.price) AS price
FROM places p
JOIN lists l ON l.url = p.list_url AND l.user_key = p.user_key
LEFT JOIN place_overrides o ON o.user_key = p.user_key AND o.place_id = p.id
LEFT JOIN place_lookups g ON g.place_id = p.id AND g.status = 'matched'
WHERE NOT COALESCE(o.hidden, false);
