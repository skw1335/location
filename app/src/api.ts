import Constants from "expo-constants";
import { userKey } from "./identity";

/**
 * On a physical device `localhost` is the phone, not the dev machine. Reuse the
 * host Expo is already serving from so the API is reachable without anyone
 * hardcoding a LAN IP.
 */
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
export const API_URL = `http://${devHost ?? "localhost"}:3000`;

/**
 * The built-in categories, mirroring `CATEGORIES` in api/src/categorize.ts.
 * Users can also file places under labels of their own, so a place's category
 * is any string, not just one of these.
 */
export const CATEGORIES = [
  "food",
  "coffee",
  "drink",
  "dessert",
  "shopping",
  "outdoors",
  "art",
  "music",
  "shows",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  note?: string;
  listName: string;
  category: string;
  /** "list" | "name" | "fallback" | "override" — how much to trust `category`. */
  categorySource: string;
  /** Restaurants only, in practice: one cuisine, one price level (1–4). */
  cuisine: string | null;
  /** "override" when the user set it, "google" when looked up on Google Maps. */
  cuisineSource: string | null;
  price: number | null;
  /** The user's own subcategories of `category`: "lunch special", "date spot". */
  subcategories: string[];
  /** Google's place id (ChIJ…) once the server has looked it up. */
  googlePlaceId: string | null;
  metres: number | null;
  walkMinutes: number | null;
}

export interface SavedList {
  url: string;
  name: string;
  count: number;
}

/** Every request carries the device key — the server rejects anything without one. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-User-Key": await userKey(),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${path} failed: ${res.status}`);
  return data as T;
}

export const getLists = () => request<SavedList[]>("/api/lists");

export const connectList = (url: string) =>
  request<{ name: string; count: number; strategy: string; lists: SavedList[] }>(
    "/api/lists",
    { method: "POST", body: JSON.stringify({ url }) },
  );

export interface PlaceFilter {
  category?: string;
  /** A subcategory of `category`; the server rejects one without it. */
  subcategory?: string;
  cuisine?: string;
}

export const getPlaces = (coords?: { lat: number; lng: number }, filter: PlaceFilter = {}) => {
  const params = new URLSearchParams();
  if (coords) {
    params.set("lat", String(coords.lat));
    params.set("lng", String(coords.lng));
  }
  for (const [key, value] of Object.entries(filter)) if (value) params.set(key, value);
  const query = params.toString();
  return request<Place[]>(`/api/places${query ? `?${query}` : ""}`);
};

export interface Count {
  name: string;
  count: number;
}

export interface Subcategory extends Count {
  /** The category it sits inside: "lunch special" → "food". */
  parent: string;
}

export interface Overview {
  builtIn: Count[];
  /** Every subcategory the user made, including ones nothing carries yet. */
  subcategories: Subcategory[];
  cuisines: Count[];
  suggestions: {
    /** Per category: ideas for subcategories the user hasn't made yet. */
    subcategories: Record<string, string[]>;
    cuisines: string[];
  };
}

export const getCategories = () => request<Overview>("/api/categories");

/** Users only ever make subcategories — always inside an existing category. */
export const createSubcategory = (parent: string, name: string) =>
  request<Subcategory>("/api/subcategories", {
    method: "POST",
    body: JSON.stringify({ parent, name }),
  });

/** Deletes a subcategory and takes it off every place. */
export const deleteSubcategory = (parent: string, name: string) =>
  request<{ deleted: string }>(
    `/api/subcategories?${new URLSearchParams({ parent, name }).toString()}`,
    { method: "DELETE" },
  );

/** Sets exactly which subcategories (of its current category) a place carries. */
export const applySubcategories = (placeId: string, names: string[]) =>
  request<{ ok: true }>("/api/places/subcategories", {
    method: "POST",
    body: JSON.stringify({ placeId, names }),
  });

/** Re-fetches any list older than 15 minutes. Cheap to call on every open. */
export const refreshLists = () =>
  request<{ checked: number; changed: number; failed: number }>("/api/lists/refresh", {
    method: "POST",
  });

/** A missing field is left alone; `null` drops the user's value for the automatic one. */
export interface OverridePatch {
  category?: string | null;
  cuisine?: string | null;
  price?: number | null;
  hidden?: boolean;
}

export const setOverride = (placeId: string, patch: OverridePatch) =>
  request<{ ok: true }>("/api/places/override", {
    method: "POST",
    body: JSON.stringify({ placeId, ...patch }),
  });
