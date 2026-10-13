# Feature ideas

Ideas and parked work, roughly most-wanted first. Nothing here is committed to;
what's being built now is in SPEC.md under "Next up".

## Sharing with other users

Share places or whole lists with friends — "here are my lunch spots near the
office". Waiting until the solo experience is good. Open questions:

- **What gets shared** — a whole category, one subcategory ("gatekeep this"
  maybe not), or a hand-picked set?
- **Live or snapshot** — does a friend see your new additions?
- **Identity** — today a user is an anonymous per-device key, so there's no
  one to share *with*. Probably needs the sign-in from "Auth" below first.
- **Privacy** — saved places show where someone eats and spends time.
  Sharing should be opt-in per thing, and easy to revoke.

An earlier group-based model (invite codes, shared feeds) is in git history at
`82cca3e`. It was removed on 2026-09-21 to focus on the solo app.

## Self-healing parser

When extraction returns 0 places, an agent reads the page and proposes a parser
fix for review. The agent should *repair the parser*, never *be* the parser: a
hallucinated lat/lng puts a restaurant in New Jersey and nothing would catch
it. Keep runtime extraction deterministic.

## Tap a place → Google Maps

The point of the app is glancing at what's near — in a grid city you already
know how to get there, and you don't want to open Maps and navigate like a bot.
So there's no routing of our own: tapping a place opens it in Google Maps,
which does the directions. Also in SPEC.md "Next up".

## More ways to sort

Distance (nearest first) stays the default and the main one. Others to add,
e.g. recently saved, name, price, list. The sort lives in `api/src/distance/`
today; a second one probably means a small `sort` query param on
`/api/places`.

How good distance is (checked against real NYC walks, 2026-10-13): order is
right where it matters (top 3 always correct, rank agreement ~0.92), and walk
minutes land within a couple once multiplied by a 1.2 detour factor. The
blind spot is **water**: from Astor Place, Domino Park in Williamsburg is
2.6 km straight but 4.6 km on foot over a bridge, so it sorts ahead of places
that are actually closer. Fixing that would take real routing, which is out
of scope — flag it if it bites in practice.

## Search

ParadeDB's `pg_search` gives BM25 full-text search inside Postgres: "tacos",
"jazz", a half-remembered name, across place names, notes and list names.
Already installed in the local database, not used yet.

## Validation agent

Double-checks automatic categories. Parked until the core app is fleshed out.

## Places API enrichment

Hours, ratings, photos. Note: `place_id` may be cached indefinitely, other
Places fields ~30 days.

## Migrations

The schema (`api/src/schema.sql`) is applied idempotently at startup, which
only handles new tables and views. Changing a column will need a real
migration tool.

## Auth

Google sign-in for *identity only*, when there's a second user and
cross-device sync matters. Grants nothing about saved places. Likely a
prerequisite for sharing.

## Takeout importer

Sanctioned fallback and backlog seeding. CSV is thin (Title, Note, URL,
Comment — no coordinates), so it needs a resolution step.
