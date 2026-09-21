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
Expo app  ──►  Bun API  ──►  SQLite cache
(iOS/Android/web)              ▲
                               │
                    ingest/ (pluggable)
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

## Open: the extractor

**Status: unsolved. This is the remaining hard part.**

Verified 2026-08-06 by probing a public Maps place page: plain fetch returns
200 OK, ~200KB, no bot wall — but nothing useful is server-rendered.
`og:title` is `"Google Maps"`, `<title>` is `"Google Maps"`, and the only
coordinates present are a viewport bounding box. The place name appears **only**
as an echo of the requested URL.

So HTML scraping is a dead end. The real target is the XHR endpoint — the shell
contains the token `entitylist`, and Maps calls something like
`/maps/preview/entitylist/getlist`.

**Plan:**

1. **Headless Chrome first.** Puppeteer loads the share URL, waits for the list
   to render, reads places from the DOM. Works without knowing Google's
   internals. Simultaneously log network requests matching `entitylist` — this
   *reveals* the endpoint.
2. **Then drop to a plain fetch** of that endpoint and delete the browser.
   Faster, cheaper, more stable.

Blocked on: one real shared list URL to observe.

> Gotcha: Bun mangles Puppeteer's bundled Chrome on macOS (`dlopen` framework
> error). Fix by extracting the Chrome zip manually — reinstalling won't help.

---

## Deferred

- **Share-target registration** — Android intent filters, iOS share extension,
  so the share sheet hands links straight to the app. This is what makes
  onboarding two taps instead of copy-paste.
- **Self-healing parser** — when extraction returns 0 places, an agent reads the
  DOM and proposes new selectors for review. The agent should *repair the
  parser*, never *be* the parser: a hallucinated lat/lng puts a restaurant in
  New Jersey and nothing would catch it. Keep runtime extraction deterministic.
- **Real walking routes** — filter by straight-line radius first, then Routes
  API for the top ~20 only. Current estimate is haversine ÷ 80 m/min.
- **Category mapping** — list name first, then place types, with manual
  per-place override. Overrides are required; type data is noisy.
- **Places API enrichment** — hours, ratings, photos. Note: `place_id` may be
  cached indefinitely, other Places fields ~30 days.
- **Auth** — Google sign-in for *identity only*, when there's a second user and
  cross-device sync matters. Grants nothing about saved places.
- **Takeout importer** — sanctioned fallback and backlog seeding. CSV is thin
  (Title, Note, URL, Comment — no coordinates), so it needs a resolution step.

---

## Data model

```sql
lists  (url PK, name, strategy, fetched_at)
places (id, list_url FK, name, lat, lng, address, note, PRIMARY KEY (id, list_url))
```

`strategy` records which extraction path produced the data — when Google
changes the page, it tells you where to start looking.

Lists are small, so refresh replaces contents wholesale rather than diffing.

**Privacy:** once this holds more than one user, cached saved places are
genuinely personal data — where people eat, drink, and spend time. Keep it
keyed per user and deletable from day one. Much easier now than retrofitted.

---

## Status

| | |
|---|---|
| Bun API, routes, SQLite cache | ✅ working |
| Distance sort (haversine + walk estimate) | ✅ working |
| Minimal web UI, browser geolocation | ✅ working |
| Expo app (iOS / Android / web) | ✅ builds clean |
| Onboarding / connect flow | ✅ working (paste-a-link) |
| Location permission + distance sort in app | ✅ working |
| Share-target registration | ❌ deferred |
| Extractor | ❌ blocked on a share URL |

Run:

```sh
cd api && bun run dev     # localhost:3000
cd app && bunx expo start # press w for web, or scan for device
```

> `bun` isn't on the PATH of non-interactive shells (it's exported from
> `.zshrc`, which only interactive shells read). Tools that spawn `bun` — like
> `expo install` — fail with `spawn bun ENOENT`. Prefix with
> `export PATH="$HOME/.bun/bin:$PATH"`.
