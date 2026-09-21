import Constants from "expo-constants";
import { userKey } from "./identity";

/**
 * On a physical device `localhost` is the phone, not the dev machine. Reuse the
 * host Expo is already serving from so the API is reachable without anyone
 * hardcoding a LAN IP.
 */
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];
export const API_URL = `http://${devHost ?? "localhost"}:3000`;

export interface Place {
  id: string;
  name: string;
  lat: number;
  lng: number;
  note?: string;
  listName: string;
  metres: number | null;
  walkMinutes: number | null;
}

export interface SavedList {
  url: string;
  name: string;
  count: number;
  groupName: string;
  shared: boolean;
}

export interface Group {
  id: string;
  name: string;
  inviteCode: string;
  members: number;
  personal: boolean;
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

export const connectList = (url: string, groupId?: string) =>
  request<{ name: string; count: number; strategy: string; lists: SavedList[] }>(
    "/api/lists",
    { method: "POST", body: JSON.stringify({ url, groupId }) },
  );

export const getPlaces = (coords?: { lat: number; lng: number }) =>
  request<Place[]>(
    `/api/places${coords ? `?lat=${coords.lat}&lng=${coords.lng}` : ""}`,
  );

export const getGroups = () => request<Group[]>("/api/groups");

export const createGroup = (name: string) =>
  request<Group>("/api/groups", { method: "POST", body: JSON.stringify({ name }) });

export const joinGroup = (inviteCode: string) =>
  request<Group>("/api/groups/join", {
    method: "POST",
    body: JSON.stringify({ inviteCode }),
  });
