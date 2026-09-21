import { beforeEach, expect, test } from "bun:test";
import type { IngestResult } from "../types";
import { mapsResponse } from "./fixture";

// db.ts opens its database at import time, so the path has to be set first.
process.env.DB_PATH = `/tmp/location-test-${crypto.randomUUID()}.sqlite`;

const { allPlaces, saveList, setPlaceOverride } = await import("../db");
const { lookUpPending, rederive } = await import("./job");

// Lookups are keyed by place id and shared across users, so ids must not
// collide with places the other suites saved under the same names.
const place = (name: string, lat: number, lng: number) => ({
  id: `${name}#${crypto.randomUUID()}`,
  name,
  lat,
  lng,
  listName: "",
});
const list = (places: ReturnType<typeof place>[]): IngestResult => ({
  places,
  strategy: "test",
  listName: "Want to go",
  fetchedAt: Date.now(),
});

/** A fake Google that knows a few places, and counts how often it's asked. */
function fakeGoogle(known: Record<string, string[]>) {
  const fake = {
    calls: 0,
    fetcher: async (url: string) => {
      fake.calls++;
      const q = new URL(url).searchParams.get("q")!;
      const pb = new URL(url).searchParams.get("pb")!;
      const [, lng, lat] = pb.match(/!2d([-\d.]+)!3d([-\d.]+)/)!.map(Number);
      return known[q] ? mapsResponse([{ name: q, categories: known[q]!, lat: lat!, lng: lng! }]) : mapsResponse([]);
    },
  };
  return fake;
}

const run = (fetcher: (url: string) => Promise<string>) => lookUpPending({ fetcher, gapMs: 0 });

/**
 * Bun runs every test file in one process, so db.ts — and its database — is
 * shared with the other suites. Lookups span all users, so first settle any
 * places those suites left behind; counts below then cover only this test's.
 */
beforeEach(async () => {
  const nothing = async () => mapsResponse([]);
  while (Object.values(await run(nothing)).some(Boolean)) {}
});
const cuisine = (user: string, name: string) => {
  const p = allPlaces(user).find((x) => x.name === name);
  return { cuisine: p?.cuisine, source: p?.cuisineSource };
};

test("looked-up cuisines show on places, and each place is only looked up once", async () => {
  const user = "lookup-basic-0000000";
  saveList("https://x/a", user, list([place("Chama Mama", 40.7068, -73.9321), place("Nowhere Cafe", 40.7, -73.9)]));
  const google = fakeGoogle({ "Chama Mama": ["Georgian restaurant", "Restaurant"] });

  expect(await run(google.fetcher)).toEqual({ matched: 1, missed: 1, failed: 0 });
  expect(cuisine(user, "Chama Mama")).toEqual({ cuisine: "georgian", source: "google" });
  expect(cuisine(user, "Nowhere Cafe")).toEqual({ cuisine: null, source: null });

  // Both outcomes are remembered; nothing is due again yet.
  const before = google.calls;
  await run(google.fetcher);
  expect(google.calls).toBe(before);
});

test("the user's cuisine beats Google's, and clearing it brings Google's back", async () => {
  const user = "lookup-override-0000";
  saveList("https://x/b", user, list([place("Los Tacos No. 1", 40.7423, -74.006)]));
  await run(fakeGoogle({ "Los Tacos No. 1": ["Taco restaurant", "Mexican restaurant"] }).fetcher);
  expect(cuisine(user, "Los Tacos No. 1")).toEqual({ cuisine: "mexican", source: "google" });

  const id = allPlaces(user)[0]!.id;
  setPlaceOverride(user, id, { cuisine: "tex-mex" });
  expect(cuisine(user, "Los Tacos No. 1")).toEqual({ cuisine: "tex-mex", source: "override" });

  setPlaceOverride(user, id, { cuisine: null });
  expect(cuisine(user, "Los Tacos No. 1")).toEqual({ cuisine: "mexican", source: "google" });
});

test("a lookup survives the list being refreshed", async () => {
  const user = "lookup-refresh-00000";
  const places = [place("Joe's Pizza", 40.7306, -73.9894)];
  saveList("https://x/c", user, list(places));
  await run(fakeGoogle({ "Joe's Pizza": ["Pizza restaurant"] }).fetcher);
  saveList("https://x/c", user, { ...list(places), listName: "renamed" });
  expect(cuisine(user, "Joe's Pizza").cuisine).toBe("pizza");
});

test("a failed request is recorded and doesn't stop the run", async () => {
  const user = "lookup-errors-000000";
  saveList("https://x/d", user, list([place("Broken", 40.7, -73.9), place("Katz's Deli", 40.722, -73.987)]));
  const summary = await run(async (url) => {
    if (url.includes("Broken")) throw new Error("429");
    return mapsResponse([{ name: "Katz's Deli", categories: ["Deli"], lat: 40.722, lng: -73.987 }]);
  });
  expect(summary).toEqual({ matched: 1, missed: 0, failed: 1 });
  expect(cuisine(user, "Katz's Deli").cuisine).toBe("deli");
});

const categoryOf = (user: string, name: string) => {
  const p = allPlaces(user).find((x) => x.name === name);
  return { category: p?.category, source: p?.categorySource };
};

test("Google's category replaces the keyword guess", async () => {
  const user = "lookup-category-0000";
  // The keyword rules call this "other": nothing in the name says restaurant.
  saveList("https://x/e", user, list([place("Phayul", 40.7478, -73.8918)]));
  expect(categoryOf(user, "Phayul").category).toBe("other");

  await run(fakeGoogle({ Phayul: ["Tibetan restaurant"] }).fetcher);
  expect(categoryOf(user, "Phayul")).toEqual({ category: "food", source: "google" });
  expect(cuisine(user, "Phayul").cuisine).toBe("tibetan");
});

test("setting a cuisine makes a place food", () => {
  const user = "cuisine-means-food00";
  saveList("https://x/f", user, list([place("Mystery Spot", 40.7, -73.9)]));
  const id = allPlaces(user)[0]!.id;
  expect(categoryOf(user, "Mystery Spot").category).toBe("other");

  setPlaceOverride(user, id, { cuisine: "tibetan" });
  expect(categoryOf(user, "Mystery Spot")).toEqual({ category: "food", source: "override" });

  // An explicit category of the user's still wins.
  setPlaceOverride(user, id, { category: "drink" });
  expect(categoryOf(user, "Mystery Spot").category).toBe("drink");
});

test("changed mapping rules apply to stored lookups without asking Google again", async () => {
  const user = "lookup-rederive-0000";
  saveList("https://x/g", user, list([place("Vanessa's", 40.7187, -73.9909)]));
  const google = fakeGoogle({ "Vanessa's": ["Restaurant", "Asian restaurant", "Chinese noodle restaurant"] });
  await run(google.fetcher);
  expect(cuisine(user, "Vanessa's").cuisine).toBe("chinese");

  const calls = google.calls;
  expect(rederive()).toBeGreaterThan(0);
  expect(google.calls).toBe(calls);
  expect(cuisine(user, "Vanessa's").cuisine).toBe("chinese");
});
