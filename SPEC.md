# location — tech spec

Your saved Google Maps places, filtered by category, sorted by how far you have
to walk. Open it standing on a corner, pick "food", get your own starred spots
nearest-first.

Designed with NYC in mind. **Not NYC-specific** — always use the device's
current location, never hardcode a city, bounding box, or street-grid
assumption.

---

## Core UX

```
1. Open app
2. "Connect your saved places" → tap
3. Maps opens → pick a list → Share → tap this app
4. Allow location
5. Done. Forever.
```

Two permissions total: location, and the share tap. No account, no password, no
Google sign-in, no OAuth consent screen. Onboarding repeats only when the user
creates a *new* list they want connected.

Every open after that: saved places, nearest first, always current.

---

## Architecture

```
Expo app  ──►  Bun API  ──►  Postgres (ParadeDB)
(iOS/web)                      ▲
                               │
                    importing/ (pluggable)
                    ├─ sharedList.ts   ← primary
                    └─ takeout.ts      ← optional fallback

           all ingest paths produce  Place[]
```

Ingestion sits behind one interface so the source can change without touching
anything downstream.

**Stale-while-revalidate.** App open → serve cache instantly → refresh in
background → update view if changed. Cache younger than 15 min doesn't hit the
network at all. Hash the parsed result and skip writes when nothing changed.

Persistence is a **cache plus user overrides**, not a system of record for
places. It exists because:

1. Fetch + parse is 1–3s; the app must open instantly
2. When the parser breaks, users see stale data instead of a blank screen
3. Every app open would otherwise be a hit on Google
4. Category overrides and hidden places are real state Google doesn't have

---

## Ingestion: how we get saved places

**Decision: public shared list URLs.**

The user shares a list in Maps; Google mints a public URL. The link points at
the *list*, not a snapshot — so when they star something new, the next fetch of
the same URL has it. Paste once, current forever.

Server fetches that URL with a plain HTTP GET. No auth, no cookies, no
credentials, nothing stored that could compromise anyone. The user can unshare
at any time and access dies immediately.

### Rejected alternatives, and why

| Approach | Why not |
|---|---|
| **OAuth "sign in with Google"** | No scope for saved places exists. Not restricted — nonexistent. Maps Platform is an API-key product for *public* place data with no concept of a signed-in user. Login can give identity; it cannot give saved places. |
| **Data Portability API** | Exactly right — Google's own docs cite this app as the example use case, with `dataportability.maps.starred_places`. **EEA/UK/Switzerland only** (DMA compliance). Not the US. Also async archive jobs, one export per 24h. |
| **Takeout (manual)** | Manual export per refresh. Rejected as the sync mechanism; still fine for seeding a backlog. |
| **Takeout (scheduled → Drive)** | Genuinely "log in and the backend syncs" — but the schedule is **every 2 months for one year**. First archive is immediate so it feels fine at install, then silently rots. Worst failure mode: invisible. Also no Takeout API exists, so the schedule must still be configured by hand once. |
| **Scraping a logged-in session** | Needs the user's Google session. Google blocks sign-in in embedded webviews (`disallowed_useragent`) by design. Server-side requests with user cookies get **the user's** account flagged. Would mean storing session cookies — account-takeover material in a breach. |

### Known constraints

- **Starred places cannot be shared.** Legacy data that lived in Google
  Bookmarks (2005–2021); Lists arrived in 2017 on a different backend and
  sharing was only ever built for Lists. Steer onboarding to Favorites, Want to
  go, and custom lists.
- **Favorites vs. Want to go is free signal** — been there vs. haven't. Expose
  it as a filter.
- **Custom list names beat Google's `types`.** A list called "best tacos" is a
  better category than anything inferred from place types, which routinely tag
  a cocktail bar as `restaurant`.

---

## The extractor

**Status: working** (`api/src/importing/sharedList.ts`, verified 2026-08-11
against a real 11-place list). Two plain HTTP GETs, no browser:

1. The share link (`maps.app.goo.gl/XXXX`) 302s to a canonical Maps URL
   carrying the list id as `!2s<id>`.
2. `/maps/preview/entitylist/getlist` returns the list as `)]}'`-prefixed JSON
   with name, owner, and every place with coordinates.

HTML scraping was a dead end: the Maps page server-renders nothing useful. The
endpoint was found by logging network requests from a headless browser; that
probe (Puppeteer) was deleted once the plain fetch worked. It's in git at
`82cca3e` if the endpoint ever moves and needs rediscovering.

Gotchas:

- **Send a non-browser User-Agent.** A desktop Chrome UA gets the
  `DurableDeepLinkUi` interstitial, which resolves the link in JavaScript and
  never redirects.
- **Field positions are observed, not documented.** Google ships untagged
  nested arrays; the parser validates coordinates so a moved index yields zero
  places rather than wrong ones.
- **Page size is 500.** Bigger lists would need paging.

---

## Categorization

Three layers, most personal wins. Automatic answers are only defaults: the
user can always recategorize, and ambiguous places (a bar Google also calls a
jazz club) are theirs to call.

1. **Category** — one high-level bucket: food, drink, coffee, dessert,
   shopping, outdoors, art (museums, galleries), music (jazz clubs, live
   music), shows (theater, comedy, cinema), other. From
   Google Maps' primary category when the place has been looked up
   ("Cocktail bar" → drink), else keyword rules on the name.
2. **Facts** — restaurants get one cuisine and one price level (1–4). These
   have a single right answer, so they're fields, not tags. **A cuisine
   means food**: Tibetan is a restaurant whatever the name says, and every
   food place should have a cuisine (the app flags those that don't).
   Only places Google calls food get a cuisine, so a bar that also serves
   tacos stays a bar. Specific beats regional ("Chinese noodle" over
   "Asian").

   Both come from a background lookup (`api/src/categories/google/`): it searches Maps'
   internal `tbm=map` endpoint for each place by name, centred on its
   coordinates, and takes the nearest result with a matching name within
   150 m. Unofficial like list ingest, so paced at one request per 1.5s, 40
   per run. Google's raw categories are stored and re-derived at startup,
   so changing the mapping rules never needs new requests. Price isn't in
   the search results; the user sets it. On a real 16-place list
   (2026-09-21): 16/16 matched, 13/13 restaurants got the right cuisine,
   and Google corrected 8 keyword categories.
3. **Subcategories** — the user's own, always *inside* a built-in: food →
   "lunch special", "date spot", "gatekeep this". Users can't create
   top-level categories. Names are scoped to their parent, a place carries
   only subcategories of its current category, and moving a place hides
   (doesn't delete) the old ones. Never assigned automatically; the sheet
   offers starter ideas per category until the user creates them.

The user can override category, cuisine and price, and reset each back to
automatic. User values live outside `places` so refreshes never erase them.

Tested 2026-09-21 on 120 random NYC spots (15 place types): 120/120 matched on
Google, 113/120 landed in the category their type implied; the rest were
fair readings of Google's primary category (e.g. a "jazz" bar Google lists as
"Bar" first). Test scripts lived in the session scratchpad, not the repo.

---

## Deferred

Feature ideas and parked work live in [FEATURES.md](FEATURES.md).

---

## Data model

Postgres via `Bun.sql`; schema in `api/src/schema.sql`, applied idempotently
at startup (real migrations once it settles). Local database is ParadeDB in
Docker (`compose.yaml`) — Postgres 18 plus `pg_search` (BM25 full-text),
PostGIS and pgvector, none used yet.

```sql
lists           (url, user_key, name, strategy, fetched_at, content_hash,
                 PRIMARY KEY (url, user_key))
places          (id, list_url, user_key, name, lat, lng, address, note,
                 category, category_source, cuisine, price,
                 PRIMARY KEY (id, list_url, user_key))
place_overrides (user_key, place_id, category, hidden, cuisine, price, updated_at,
                 PRIMARY KEY (user_key, place_id))
subcategories       (user_key, parent, name, created_at,
                     PRIMARY KEY (user_key, parent, name))
place_subcategories (user_key, place_id, parent, name, created_at,
                     PRIMARY KEY (user_key, place_id, parent, name))
place_lookups       (place_id PK, status, google_id, google_categories,
                     category, cuisine, checked_at)   -- shared across users
effective_places    VIEW: each place with the winning category/cuisine/price
                    (override > Google > keyword), hidden places removed
```

`user_key` is the opaque per-device key the app sends. Everything is scoped by
it; there are no accounts and no sharing between users.

`strategy` records which extraction path produced the data — when Google
changes the page, it tells you where to start looking.

Lists are small, so refresh replaces contents wholesale rather than diffing.

**Privacy:** once this holds more than one user, cached saved places are
genuinely personal data — where people eat, drink, and spend time. Keep it
keyed per user and deletable from day one. Much easier now than retrofitted.

---

## iOS distribution

iPhone only; Android was dropped. What it takes to get the app onto a phone:

| Route | Cost | Catch |
|---|---|---|
| **Expo Go** (what works today) | free | Runs only while the Mac serves it, same Wi-Fi. No share extension. |
| **Xcode, free Apple ID** | free | Needs full Xcode (not installed; only CLT). Install expires every 7 days. No app groups → no share extension. |
| **Home-screen web app** (Safari → Add to Home Screen) | free | Needs the API hosted. iOS web apps can't be share targets. |
| **Apple Developer Program** | $99/yr | Required for the App Store and TestFlight, and for the share extension's app group. No way around it for distribution. |

The `expo-sharing` share extension is configured (`app.json`, verified via
prebuild) but only runs in a paid-account dev build. **Free alternative:** an
iOS Shortcut ("Add to location") in the share sheet that opens
`location://connect?url=…` (in Expo Go, `exp://<mac>:8081/--/connect?url=…`)
— works with every route above, one tap more than a real extension. Built;
setup steps in `app/SHORTCUT.md`.

Bundle id `com.kellmanwanzer.location` is a placeholder; change it before
registering anything with Apple.

---

## Code layout (`api/src`)

Grouped by feature; each folder holds its logic and its own queries.

| | |
|---|---|
| `index.ts` | HTTP routes (`Bun.serve`) |
| `db.ts`, `schema.sql` | Postgres connection, schema, delete-my-data |
| `places.ts` | the main read: a user's places with effective values and filters |
| `importing/` | shared-list fetch (`sharedList`), list cache (`lists`), background refresh (`sync`) |
| `categories/` | keyword rules, override precedence (`effective`), overrides, subcategories, suggestions, startup re-derive |
| `categories/google/` | background Google Maps lookup → category + cuisine |
| `distance/` | haversine, walking-time estimate, nearest-first sort |

## Status

| | |
|---|---|
| Bun API, routes, Postgres (ParadeDB) | ✅ working, 2026-10-13 |
| List ingest (`getlist` plain fetch) | ✅ verified on a real 16-place list, 2026-09-21 |
| Background list refresh (stale-while-revalidate, 15 min) | ✅ working |
| Categorization: Google lookup → category + cuisine | ✅ working (see Categorization) |
| User overrides: category, cuisine, price, hide | ✅ working |
| User subcategories (inside a built-in) | ✅ working |
| Distance sort (straight line, ×1.2 for walk time) | ✅ checked against real NYC walks, 2026-10-13 (see FEATURES.md) |
| Live location in app (re-sorts every 50 m) | ✅ in code — not yet tried on a phone |
| Expo app (iOS / web) | ✅ type-checks, web build clean |
| Connect a list | ✅ paste-a-link, Shortcut deep link (`app/SHORTCUT.md`); share extension configured (see iOS distribution) |
| Tap a place → Google Maps walking directions | ✅ uses Google's place id (all 31 of a real list had one) |
| Minimal web UI (`api/public`) | ✅ working |
| Hosting the API | ⏸ later — runs on the Mac. Prefer the Mac + a private tunnel (e.g. Tailscale): Google blocks data-center IPs far more than home ones, and ingest + lookups depend on Google |
| Tests | `cd api && bun test` (60, needs the database up — each run uses a throwaway one), `cd app && bun test` (9) |

## Next up

In rough order — the user's call:

1. **Try it on the iPhone** in Expo Go: live location, the Shortcut, tap to
   open Maps, overrides.
2. **Hosting** — see Status.
3. Smaller: renaming subcategories (delete + recreate today); "also fits"
   chips from Google's other categories for ambiguous places; price is
   manual only.
4. **More ways to sort** — distance stays the default (see FEATURES.md).
5. Later: validation agent; NestJS/TypeORM undecided (CLAUDE.md says
   `Bun.sql`, which TypeORM's `pg` driver would replace).

Run:

```sh
docker compose up -d      # Postgres (ParadeDB); OrbStack provides docker
cd api && bun run dev     # localhost:3000
cd app && bunx expo start # press w for web, or scan for device
```

> `bun` isn't on the PATH of non-interactive shells (it's exported from
> `.zshrc`, which only interactive shells read). Tools that spawn `bun` — like
> `expo install` — fail with `spawn bun ENOENT`. Prefix with
> `export PATH="$HOME/.bun/bin:$PATH"`.
