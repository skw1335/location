import index from "../public/index.html";
import { CATEGORIES, isCategory } from "./categorize";
import {
  allPlaces,
  categoryCounts,
  createGroup,
  forgetUser,
  groupsFor,
  isMember,
  joinByInvite,
  listAge,
  personalGroup,
  savedLists,
  saveList,
  setPlaceOverride,
} from "./db";
import { haversine, walkingMinutes } from "./geo";
import { ingestSharedList } from "./ingest/sharedList";

const STALE_AFTER_MS = 15 * 60 * 1000;
const DEV = process.env.NODE_ENV !== "production";

/**
 * The app sends an opaque per-device key. It's not identity — it proves nothing
 * about who you are — but it partitions the data so one device can only reach
 * groups it belongs to. When sign-in lands, the account id takes this slot and
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
        const { url, groupId } = (await req.json()) as {
          url?: string;
          groupId?: string;
        };
        if (!url?.startsWith("http")) return json({ error: "need a share url" }, 400);

        // No group named means "mine". A named group must be one you're in —
        // otherwise anyone could write lists into a stranger's feed.
        let target = groupId;
        if (target) {
          if (!isMember(userKey, target)) return json({ error: "not in that group" }, 403);
        } else {
          target = personalGroup(userKey).id;
        }

        const age = listAge(url, target);
        if (age !== null && age < STALE_AFTER_MS) {
          return json({ cached: true, ageMs: age, lists: savedLists(userKey) });
        }

        try {
          const result = await ingestSharedList(url);
          saveList(url, target, result);
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

    "/api/groups": {
      OPTIONS: preflight,

      // Touching this mints the personal group, so a fresh device always has one.
      GET: scoped((_req, userKey) => {
        personalGroup(userKey);
        return json(groupsFor(userKey));
      }),

      POST: scoped(async (req, userKey) => {
        const { name } = (await req.json()) as { name?: string };
        const trimmed = name?.trim();
        if (!trimmed) return json({ error: "need a group name" }, 400);
        return json(createGroup(userKey, trimmed.slice(0, 60)));
      }),
    },

    "/api/groups/join": {
      OPTIONS: preflight,

      POST: scoped(async (req, userKey) => {
        const { inviteCode } = (await req.json()) as { inviteCode?: string };
        if (!inviteCode?.trim()) return json({ error: "need an invite code" }, 400);
        const group = joinByInvite(userKey, inviteCode);
        if (!group) return json({ error: "no group with that code" }, 404);
        return json(group);
      }),
    },

    // Everything the app needs to render a screen: places, sorted by how far
    // the user actually has to walk.
    "/api/categories": scoped((_req, userKey) => json(categoryCounts(userKey))),

    // Correct a category, or hide a place outright. Both are user judgements,
    // so they survive every later refresh of the underlying list.
    "/api/places/override": {
      OPTIONS: preflight,
      POST: scoped(async (req, userKey) => {
        const { placeId, category, hidden } = (await req.json()) as {
          placeId?: string;
          category?: string;
          hidden?: boolean;
        };
        if (!placeId) return json({ error: "need a placeId" }, 400);
        if (category !== undefined && !isCategory(category)) {
          return json({ error: `category must be one of: ${CATEGORIES.join(", ")}` }, 400);
        }
        const updated = setPlaceOverride(userKey, placeId, { category, hidden });
        if (!updated) return json({ error: "no such place in your lists" }, 404);
        return json({ ok: true, groups: updated });
      }),
    },

    "/api/places": scoped((req, userKey) => {
      const { searchParams } = new URL(req.url);
      const lat = Number(searchParams.get("lat"));
      const lng = Number(searchParams.get("lng"));

      const wanted = searchParams.get("category");
      if (wanted !== null && !isCategory(wanted)) {
        return json({ error: `unknown category "${wanted}"` }, 400);
      }
      const places = allPlaces(userKey, wanted ?? undefined);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return json(places.map((p) => ({ ...p, metres: null, walkMinutes: null })));
      }

      const withDistance = places.map((p) => {
        const metres = Math.round(haversine(lat, lng, p.lat, p.lng));
        return { ...p, metres, walkMinutes: walkingMinutes(metres) };
      });
      withDistance.sort((a, b) => a.metres - b.metres);
      return json(withDistance);
    }),
  },

  development: DEV && { hmr: true, console: true },
});

console.log(`listening on ${server.url}`);
