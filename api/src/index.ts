import index from "../public/index.html";
import { isCategory, normalizeLabel } from "./categories/categorize";
import { lookUpPending, rederive } from "./categories/google/job";
import { categoryOverview } from "./categories/overview";
import { type OverridePatch, setPlaceOverride } from "./categories/overrides";
import { rederiveKeywordCategories } from "./categories/rederive";
import {
  createSubcategory,
  deleteSubcategory,
  setPlaceSubcategories,
} from "./categories/subcategories";
import { suggestionsFor } from "./categories/suggestions";
import { forgetUser } from "./db";
import { listAge, savedLists, saveList } from "./importing/lists";
import { ingestSharedList } from "./importing/sharedList";
import { refreshStale, STALE_AFTER_MS } from "./importing/sync";
import { allPlaces } from "./places";
import { byDistance } from "./distance/distance";

const DEV = process.env.NODE_ENV !== "production";

/**
 * The app sends an opaque per-device key. It's not identity — it proves nothing
 * about who you are — but it partitions the data so one device can only reach
 * its own lists. When sign-in lands, the account id takes this slot and
 * nothing downstream changes.
 */
const USER_KEY_HEADER = "x-user-key";
const isValidKey = (k: string | null): k is string =>
  !!k && /^[A-Za-z0-9_-]{16,128}$/.test(k);

// Header-based auth, no cookies — so a wildcard origin grants nothing on its own.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": `Content-Type, ${USER_KEY_HEADER}`,
  "Access-Control-Max-Age": "86400",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const preflight = () => new Response(null, { status: 204, headers: CORS });

/** Wraps a handler so it only runs with a valid key, and always answers preflight. */
function scoped(
  handler: (req: Request, userKey: string) => Response | Promise<Response>,
) {
  return (req: Request) => {
    if (req.method === "OPTIONS") return preflight();
    const key = req.headers.get(USER_KEY_HEADER);
    if (!isValidKey(key)) return json({ error: "missing or malformed user key" }, 401);
    return handler(req, key);
  };
}

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  routes: {
    "/": index,

    "/api/lists": {
      OPTIONS: preflight,

      GET: scoped((_req, userKey) => json(savedLists(userKey))),

      POST: scoped(async (req, userKey) => {
        const { url } = (await req.json()) as { url?: string };
        if (!url?.startsWith("http")) return json({ error: "need a share url" }, 400);

        const age = listAge(url, userKey);
        if (age !== null && age < STALE_AFTER_MS) {
          return json({ cached: true, ageMs: age, lists: savedLists(userKey) });
        }

        try {
          const result = await ingestSharedList(url);
          saveList(url, userKey, result);
          // New places need looking up; the app picks up the results on its next load.
          void lookUpPending();
          return json({
            cached: false,
            name: result.listName,
            count: result.places.length,
            strategy: result.strategy,
            lists: savedLists(userKey),
          });
        } catch (err) {
          return json({ error: String(err) }, 502);
        }
      }),

      // Deletable from day one, per SPEC.md — not bolted on after there's data to lose.
      DELETE: scoped((_req, userKey) => {
        forgetUser(userKey);
        return json({ deleted: true });
      }),
    },

    // Stale-while-revalidate: the app draws from cache first, then calls this
    // and redraws only if something changed.
    "/api/lists/refresh": {
      OPTIONS: preflight,
      POST: scoped(async (_req, userKey) => {
        const summary = await refreshStale(userKey);
        // Catches places added in Maps, plus anything due a re-check.
        void lookUpPending();
        return json(summary);
      }),
    },

    // Built-in counts, the user's subcategories, cuisines, and ideas for new
    // subcategories: everything the filter chips and the edit sheet draw from.
    "/api/categories": scoped((_req, userKey) => {
      const overview = categoryOverview(userKey);
      return json({ ...overview, suggestions: suggestionsFor(overview) });
    }),

    // Users don't make top-level categories — only subcategories inside one of
    // the built-ins, so "lunch special" always belongs to food.
    "/api/subcategories": {
      OPTIONS: preflight,

      POST: scoped(async (req, userKey) => {
        const body = (await req.json()) as { parent?: string; name?: string };
        if (!isCategory(body.parent)) {
          return json({ error: "parent must be an existing category" }, 400);
        }
        const name = normalizeLabel(body.name);
        if (!name) return json({ error: "name must be 1–40 characters" }, 400);
        if (isCategory(name)) return json({ error: `"${name}" is already a category` }, 409);
        return json(createSubcategory(userKey, body.parent, name));
      }),

      DELETE: scoped((req, userKey) => {
        const { searchParams } = new URL(req.url);
        const parent = searchParams.get("parent");
        const name = normalizeLabel(searchParams.get("name"));
        if (!isCategory(parent) || !name || !deleteSubcategory(userKey, parent, name)) {
          return json({ error: "no such subcategory" }, 404);
        }
        return json({ deleted: name });
      }),
    },

    // Correct a category, set a cuisine or price, or hide a place outright. All
    // user judgements, so they survive every later refresh of the list.
    "/api/places/override": {
      OPTIONS: preflight,
      POST: scoped(async (req, userKey) => {
        const body = (await req.json()) as {
          placeId?: string;
          category?: string | null;
          cuisine?: string | null;
          price?: number | null;
          hidden?: boolean;
        };
        if (!body.placeId) return json({ error: "need a placeId" }, 400);

        // null means "back to automatic" for any of these.
        const patch: OverridePatch = { hidden: body.hidden };
        if (body.category !== undefined) {
          // Only built-ins here; the user's own categories are applied separately.
          if (body.category !== null && !isCategory(body.category)) {
            return json({ error: "category must be a built-in one" }, 400);
          }
          patch.category = body.category;
        }
        if (body.cuisine !== undefined) {
          const cuisine = body.cuisine === null ? null : normalizeLabel(body.cuisine);
          if (body.cuisine !== null && !cuisine) {
            return json({ error: "cuisine must be 1–40 characters" }, 400);
          }
          patch.cuisine = cuisine;
        }
        if (body.price !== undefined) {
          if (body.price !== null && ![1, 2, 3, 4].includes(body.price)) {
            return json({ error: "price must be 1–4, or null" }, 400);
          }
          patch.price = body.price;
        }

        if (!setPlaceOverride(userKey, body.placeId, patch)) {
          return json({ error: "no such place in your lists" }, 404);
        }
        return json({ ok: true });
      }),
    },

    // Sets exactly which subcategories a place carries, from those inside its
    // current category. Sending the whole set keeps the client simple: a tap
    // is just "here's the new set".
    "/api/places/subcategories": {
      OPTIONS: preflight,
      POST: scoped(async (req, userKey) => {
        const { placeId, names } = (await req.json()) as { placeId?: string; names?: unknown };
        if (!placeId) return json({ error: "need a placeId" }, 400);
        if (!Array.isArray(names) || names.length > 20) {
          return json({ error: "names must be a list of at most 20" }, 400);
        }
        const clean = [...new Set(names.map(normalizeLabel))];
        if (clean.includes(null)) return json({ error: "each name must be 1–40 characters" }, 400);

        const result = setPlaceSubcategories(userKey, placeId, clean as string[]);
        if (!result.ok && result.error === "no such place") {
          return json({ error: "no such place in your lists" }, 404);
        }
        if (!result.ok) {
          return json({ error: `not a subcategory of this place's category: ${result.names?.join(", ")}` }, 400);
        }
        return json(result);
      }),
    },

    // Everything the app needs to render a screen: places, sorted by how far
    // the user actually has to walk.
    "/api/places": scoped((req, userKey) => {
      const { searchParams } = new URL(req.url);
      const lat = Number(searchParams.get("lat"));
      const lng = Number(searchParams.get("lng"));

      const filter = (key: string) => normalizeLabel(searchParams.get(key)) ?? undefined;
      const place = { category: filter("category"), subcategory: filter("subcategory") };
      if (place.subcategory && !place.category) {
        return json({ error: "subcategory needs its category" }, 400);
      }
      const places = allPlaces(userKey, { ...place, cuisine: filter("cuisine") });

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(places.map((p) => ({ ...p, metres: null, walkMinutes: null })));
      }

      return json(byDistance(places, lat, lng));
    }),
  },

  development: DEV && { hmr: true, console: true },
});

console.log(`listening on ${server.url}`);

// Apply any change to the categorisation rules to places already stored —
// keyword guesses and Google lookups alike — then pick up anything a previous
// lookup run didn't reach.
rederiveKeywordCategories();
rederive();
void lookUpPending();
