import type { IngestResult, Place } from "../types";

/**
 * Ingests a public Google Maps shared list.
 *
 * Two plain HTTP GETs, no browser, no auth, no cookies:
 *
 *   1. The share link (`maps.app.goo.gl/XXXX`) 302s to a canonical Maps URL
 *      carrying the list id as `!2s<id>`.
 *   2. `/maps/preview/entitylist/getlist` returns the list as `)]}'`-prefixed
 *      JSON — name, owner, and every place with coordinates.
 *
 * Verified 2026-08-11 against a real 11-place list.
 *
 * The user-agent matters more than it looks. Sending a *desktop browser* UA
 * gets you Google's `DurableDeepLinkUi` interstitial, which resolves the link
 * in JavaScript and never issues a redirect — that is what defeated the
 * original HTML-scraping approach. Any non-browser UA gets a clean 302, so we
 * deliberately identify as a bot here rather than trying to look like Chrome.
 */

const UA = "location-app/1.0 (+https://github.com/; list ingest)";

/** Where Google hands back a list id in canonical Maps URLs. */
const LIST_ID_IN_DATA = /!2s([A-Za-z0-9_-]{16,})/;
/** The shareable canonical form, in case a user pastes that instead. */
const LIST_ID_IN_PATH = /\/maps\/placelists\/list\/([A-Za-z0-9_-]{16,})/;

const isLat = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -90 && n <= 90 && n !== 0;
const isLng = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -180 && n <= 180 && n !== 0;

/**
 * Follows short links by hand — `redirect: "manual"` — because we only want the
 * `Location` header, not the page body at the other end.
 */
export async function resolveListId(input: string): Promise<string> {
  const direct = input.match(LIST_ID_IN_PATH) ?? input.match(LIST_ID_IN_DATA);
  if (direct) return direct[1]!;

  let url = input;
  // Short links occasionally chain; a handful of hops is plenty.
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      redirect: "manual",
    });
    const next = res.headers.get("location");
    if (!next) break;

    const found = next.match(LIST_ID_IN_PATH) ?? next.match(LIST_ID_IN_DATA);
    if (found) return found[1]!;
    url = new URL(next, url).toString();
  }

  throw new Error(
    "couldn't find a list id — is this a shared *list* link? " +
      "Individual places and starred places won't work.",
  );
}

/**
 * `pb` is Google's positional-parameter encoding. Only the id and the page size
 * carry meaning for us; the session token the live page sends is not required.
 * `!4i500` is the page size — lists larger than that would need paging.
 */
const getlistUrl = (listId: string, pageSize = 500) =>
  "https://www.google.com/maps/preview/entitylist/getlist?authuser=0&hl=en&gl=us&pb=" +
  encodeURIComponent(
    `!1m6!1s${listId}!2e3!3m1!1e1!3m1!1e9!2e2!3e2!4i${pageSize}`,
  );

/** Google prefixes its JSON with `)]}'` to make it non-executable. */
function parseGuardedJson(body: string): unknown {
  const start = body.indexOf("\n");
  const payload = body.startsWith(")]}'") && start !== -1 ? body.slice(start + 1) : body;
  return JSON.parse(payload);
}

/**
 * Reads places out of a decoded getlist response.
 *
 * Google ships an untagged nested array, so the field positions below are
 * observed, not documented, and they will eventually move. We read defensively
 * and validate coordinates rather than trusting the shape — a wrong index
 * should yield zero places, never a place in the wrong hemisphere.
 */
function placesFrom(root: unknown): Place[] {
  const entries = (root as any)?.[0]?.[8];
  if (!Array.isArray(entries)) return [];

  const places: Place[] = [];
  for (const entry of entries) {
    const detail = entry?.[1];
    const name = entry?.[2];
    const lat = detail?.[5]?.[2];
    const lng = detail?.[5]?.[3];

    if (typeof name !== "string" || !name) continue;
    if (!isLat(lat) || !isLng(lng)) continue;

    // Google's own place id is stable and cacheable indefinitely; fall back to
    // name+coords so a missing id never drops the place.
    const placeId = typeof detail?.[7] === "string" ? detail[7] : null;
    const address = typeof detail?.[4] === "string" ? detail[4] : undefined;

    places.push({
      id: placeId ?? `${name}@${lat.toFixed(5)},${lng.toFixed(5)}`,
      name,
      lat,
      lng,
      address,
      listName: "",
    });
  }
  return places;
}

/** The list's own title, e.g. "Want to go". */
function listNameFrom(root: unknown): string {
  const name = (root as any)?.[0]?.[4];
  return typeof name === "string" && name.trim() ? name.trim() : "Saved places";
}

export async function ingestSharedList(url: string): Promise<IngestResult> {
  const listId = await resolveListId(url);

  const res = await fetch(getlistUrl(listId), {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  if (!res.ok) throw new Error(`getlist failed: ${res.status} ${res.statusText}`);

  const root = parseGuardedJson(await res.text());
  const listName = listNameFrom(root);
  const places = placesFrom(root).map((p) => ({ ...p, listName }));

  return {
    places,
    strategy: places.length ? "entitylist" : "none",
    listName,
    fetchedAt: Date.now(),
  };
}
