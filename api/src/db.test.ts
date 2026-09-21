import { expect, test } from "bun:test";
import type { IngestResult } from "./types";

// db.ts opens its database at import time, so the path has to be set first.
process.env.DB_PATH = `/tmp/location-test-${crypto.randomUUID()}.sqlite`;

const {
  allPlaces,
  categoryOverview,
  createSubcategory,
  deleteSubcategory,
  forgetUser,
  rederiveKeywordCategories,
  saveList,
  savedLists,
  setPlaceSubcategories,
  setPlaceOverride,
} = await import("./db");

const result = (name: string): IngestResult => ({
  places: [{ id: name, name, lat: 40.7, lng: -73.9, listName: "l" }],
  strategy: "test",
  listName: `${name}'s list`,
  fetchedAt: Date.now(),
});

const alice = "alice-key-0000000000";
const bob = "bob-key-00000000000000";

test("a user's places are invisible to everyone else", () => {
  saveList("https://x/alice", alice, result("alice-spot"));

  expect(allPlaces(alice).map((p) => p.name)).toEqual(["alice-spot"]);
  expect(allPlaces(bob)).toEqual([]);
  expect(savedLists(bob)).toEqual([]);
});

test("the same list connected by two users is kept separately", () => {
  saveList("https://x/shared", alice, result("taco-place"));
  saveList("https://x/shared", bob, result("taco-place"));

  forgetUser(bob);

  expect(allPlaces(bob)).toEqual([]);
  expect(allPlaces(alice).map((p) => p.name)).toContain("taco-place");
});

test("overrides survive a refresh of the list", () => {
  expect(setPlaceOverride(alice, "alice-spot", { hidden: true })).toBe(true);
  saveList("https://x/alice", alice, result("alice-spot"));

  expect(allPlaces(alice).map((p) => p.name)).not.toContain("alice-spot");
});

test("can't override a place you don't have", () => {
  expect(setPlaceOverride(bob, "alice-spot", { hidden: true })).toBe(false);
});

test("forgetting a user removes their lists, places, and overrides", () => {
  forgetUser(alice);

  expect(savedLists(alice)).toEqual([]);
  expect(allPlaces(alice)).toEqual([]);
  // A fresh reconnect starts clean — the old hide doesn't linger.
  saveList("https://x/alice", alice, result("alice-spot"));
  expect(allPlaces(alice).map((p) => p.name)).toEqual(["alice-spot"]);
});

test("a built-in category can be corrected and reset to automatic", () => {
  const user = "builtin-override-0000";
  saveList("https://x/bars", user, result("Bar Goto"));
  const place = () => allPlaces(user).find((p) => p.name === "Bar Goto");

  setPlaceOverride(user, "Bar Goto", { category: "food" });
  expect(place()).toMatchObject({ category: "food", categorySource: "override" });

  // Hiding and un-hiding leaves the correction alone.
  setPlaceOverride(user, "Bar Goto", { hidden: true });
  setPlaceOverride(user, "Bar Goto", { hidden: false });
  expect(place()?.category).toBe("food");

  setPlaceOverride(user, "Bar Goto", { category: null });
  expect(place()?.category).toBe("drink");
  expect(place()?.categorySource).not.toBe("override");
});

const bars = (user: string) => {
  const r = result("Bar Goto");
  r.places.push({ id: "Jimmy's Corner", name: "Jimmy's Corner", lat: 40.75, lng: -73.98, listName: "l" });
  saveList("https://x/bars", user, r);
};
const find = (user: string, name: string) => allPlaces(user).find((p) => p.name === name);

const tacos = (user: string) => {
  const r = result("Los Tacos No. 1");
  r.places.push({ id: "Katz's", name: "Katz's Deli", lat: 40.722, lng: -73.987, listName: "l" });
  saveList("https://x/food", user, r);
};

test("users make subcategories inside a category and apply them", () => {
  const user = "sub-create-apply-000";
  tacos(user);
  createSubcategory(user, "food", "lunch special");
  createSubcategory(user, "food", "gatekeep this");

  setPlaceSubcategories(user, "Los Tacos No. 1", ["lunch special", "gatekeep this"]);
  setPlaceSubcategories(user, "Katz's", ["lunch special"]);

  // Still food, and narrowable within food.
  expect(allPlaces(user, { category: "food" })).toHaveLength(2);
  expect(
    allPlaces(user, { category: "food", subcategory: "gatekeep this" }).map((p) => p.name),
  ).toEqual(["Los Tacos No. 1"]);
  expect(find(user, "Los Tacos No. 1")?.subcategories).toEqual(["gatekeep this", "lunch special"]);
});

test("a created subcategory exists before anything carries it", () => {
  const user = "sub-unused-000000000";
  tacos(user);
  createSubcategory(user, "food", "date spot");
  expect(categoryOverview(user).subcategories).toEqual([
    { parent: "food", name: "date spot", count: 0 },
  ]);
});

test("the same name under two categories is two subcategories", () => {
  const user = "sub-scoped-names-000";
  bars(user);
  tacos(user);
  createSubcategory(user, "food", "date spot");
  createSubcategory(user, "drink", "date spot");
  setPlaceSubcategories(user, "Bar Goto", ["date spot"]);

  expect(categoryOverview(user).subcategories).toEqual([
    { parent: "drink", name: "date spot", count: 1 },
    { parent: "food", name: "date spot", count: 0 },
  ]);
  expect(allPlaces(user, { category: "food", subcategory: "date spot" })).toEqual([]);
});

test("a place only takes subcategories of its own category", () => {
  const user = "sub-wrong-parent-000";
  bars(user);
  createSubcategory(user, "food", "lunch special");
  expect(setPlaceSubcategories(user, "Bar Goto", ["lunch special"])).toEqual({
    ok: false,
    error: "unknown subcategory",
    names: ["lunch special"],
  });
  expect(setPlaceSubcategories(user, "not-mine", [])).toEqual({ ok: false, error: "no such place" });
});

test("moving a place hides its old subcategories, and moving back restores them", () => {
  const user = "sub-move-restore-000";
  tacos(user);
  createSubcategory(user, "food", "gatekeep this");
  setPlaceSubcategories(user, "Los Tacos No. 1", ["gatekeep this"]);

  setPlaceOverride(user, "Los Tacos No. 1", { category: "drink" });
  expect(find(user, "Los Tacos No. 1")?.subcategories).toEqual([]);
  expect(categoryOverview(user).subcategories[0]?.count).toBe(0);

  setPlaceOverride(user, "Los Tacos No. 1", { category: null });
  expect(find(user, "Los Tacos No. 1")?.subcategories).toEqual(["gatekeep this"]);
});

test("subcategories survive a refresh of the list", () => {
  const user = "sub-survive-00000000";
  tacos(user);
  createSubcategory(user, "food", "date spot");
  setPlaceSubcategories(user, "Katz's", ["date spot"]);
  tacos(user);
  expect(find(user, "Katz's Deli")?.subcategories).toEqual(["date spot"]);
});

test("deleting a subcategory takes it off every place", () => {
  const user = "sub-delete-000000000";
  tacos(user);
  createSubcategory(user, "food", "cheap eats");
  setPlaceSubcategories(user, "Los Tacos No. 1", ["cheap eats"]);
  setPlaceSubcategories(user, "Katz's", ["cheap eats"]);

  expect(deleteSubcategory(user, "food", "cheap eats")).toBe(true);
  expect(find(user, "Katz's Deli")?.subcategories).toEqual([]);
  expect(categoryOverview(user).subcategories).toEqual([]);
  expect(deleteSubcategory(user, "food", "cheap eats")).toBe(false);
});

test("counts are of places, not list entries", () => {
  const user = "sub-counts-000000000";
  bars(user);
  // The same bar in a second list must not double anything.
  saveList("https://x/other", user, result("Bar Goto"));
  createSubcategory(user, "drink", "date bar");
  setPlaceSubcategories(user, "Bar Goto", ["date bar"]);

  const overview = categoryOverview(user);
  expect(overview.builtIn).toEqual([{ name: "drink", count: 2 }]);
  expect(overview.subcategories).toEqual([{ parent: "drink", name: "date bar", count: 1 }]);
});

test("cuisine and price are set, filtered on, and reset", () => {
  const user = "cuisine-price-000000";
  saveList("https://x/food", user, result("Los Tacos No. 1"));
  const taco = () => find(user, "Los Tacos No. 1");

  setPlaceOverride(user, "Los Tacos No. 1", { cuisine: "mexican", price: 1 });
  expect(taco()).toMatchObject({ cuisine: "mexican", price: 1 });
  expect(allPlaces(user, { cuisine: "mexican" })).toHaveLength(1);
  expect(categoryOverview(user).cuisines).toEqual([{ name: "mexican", count: 1 }]);

  // Changing one field leaves the other alone.
  setPlaceOverride(user, "Los Tacos No. 1", { price: 2 });
  expect(taco()).toMatchObject({ cuisine: "mexican", price: 2 });

  setPlaceOverride(user, "Los Tacos No. 1", { cuisine: null, price: null });
  expect(taco()).toMatchObject({ cuisine: null, price: null });
});

test("forgetting a user removes their subcategories too", () => {
  const user = "forget-sub-000000000";
  bars(user);
  createSubcategory(user, "drink", "date bar");
  setPlaceSubcategories(user, "Bar Goto", ["date bar"]);
  forgetUser(user);
  bars(user);
  expect(find(user, "Bar Goto")?.subcategories).toEqual([]);
  expect(categoryOverview(user).subcategories).toEqual([]);
});

test("stored categories follow the current rules, and retired ones reset", async () => {
  const user = "rederive-keywords-00";
  saveList("https://x/art", user, result("Whitney Museum"));
  const { Database } = await import("bun:sqlite");
  const raw = new Database(process.env.DB_PATH!);
  // As if saved under an old rule set that still had "culture".
  raw.query(`UPDATE places SET category = 'culture' WHERE user_key = ?`).run(user);
  raw.query(
    `INSERT INTO place_overrides (user_key, place_id, category, updated_at) VALUES (?, ?, 'culture', 0)`,
  ).run(user, "Whitney Museum");

  rederiveKeywordCategories();
  const [place] = allPlaces(user);
  expect(place?.category).toBe("art");
  expect(place?.categorySource).not.toBe("override");
});
