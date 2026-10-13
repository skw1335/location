import { expect, test } from "bun:test";
import type { IngestResult } from "./types";

const { forgetUser, sql } = await import("./db");
const { saveList, savedLists } = await import("./importing/lists");
const { allPlaces } = await import("./places");
const { categoryOverview } = await import("./categories/overview");
const { setPlaceOverride } = await import("./categories/overrides");
const { rederiveKeywordCategories } = await import("./categories/rederive");
const { createSubcategory, deleteSubcategory, setPlaceSubcategories } = await import(
  "./categories/subcategories"
);

const result = (name: string): IngestResult => ({
  places: [{ id: name, name, lat: 40.7, lng: -73.9, listName: "l" }],
  strategy: "test",
  listName: `${name}'s list`,
  fetchedAt: Date.now(),
});

const alice = "alice-key-0000000000";
const bob = "bob-key-00000000000000";

test("a user's places are invisible to everyone else", async () => {
  await saveList("https://x/alice", alice, result("alice-spot"));

  expect((await allPlaces(alice)).map((p) => p.name)).toEqual(["alice-spot"]);
  expect(await allPlaces(bob)).toEqual([]);
  expect(await savedLists(bob)).toEqual([]);
});

test("the same list connected by two users is kept separately", async () => {
  await saveList("https://x/shared", alice, result("taco-place"));
  await saveList("https://x/shared", bob, result("taco-place"));

  await forgetUser(bob);

  expect(await allPlaces(bob)).toEqual([]);
  expect((await allPlaces(alice)).map((p) => p.name)).toContain("taco-place");
});

test("overrides survive a refresh of the list", async () => {
  expect(await setPlaceOverride(alice, "alice-spot", { hidden: true })).toBe(true);
  await saveList("https://x/alice", alice, result("alice-spot"));

  expect((await allPlaces(alice)).map((p) => p.name)).not.toContain("alice-spot");
});

test("can't override a place you don't have", async () => {
  expect(await setPlaceOverride(bob, "alice-spot", { hidden: true })).toBe(false);
});

test("forgetting a user removes their lists, places, and overrides", async () => {
  await forgetUser(alice);

  expect(await savedLists(alice)).toEqual([]);
  expect(await allPlaces(alice)).toEqual([]);
  // A fresh reconnect starts clean — the old hide doesn't linger.
  await saveList("https://x/alice", alice, result("alice-spot"));
  expect((await allPlaces(alice)).map((p) => p.name)).toEqual(["alice-spot"]);
});

test("a built-in category can be corrected and reset to automatic", async () => {
  const user = "builtin-override-0000";
  await saveList("https://x/bars", user, result("Bar Goto"));
  const place = async () => (await allPlaces(user)).find((p) => p.name === "Bar Goto");

  await setPlaceOverride(user, "Bar Goto", { category: "food" });
  expect(await place()).toMatchObject({ category: "food", categorySource: "override" });

  // Hiding and un-hiding leaves the correction alone.
  await setPlaceOverride(user, "Bar Goto", { hidden: true });
  await setPlaceOverride(user, "Bar Goto", { hidden: false });
  expect((await place())?.category).toBe("food");

  await setPlaceOverride(user, "Bar Goto", { category: null });
  expect((await place())?.category).toBe("drink");
  expect((await place())?.categorySource).not.toBe("override");
});

const bars = async (user: string) => {
  const r = result("Bar Goto");
  r.places.push({ id: "Jimmy's Corner", name: "Jimmy's Corner", lat: 40.75, lng: -73.98, listName: "l" });
  await saveList("https://x/bars", user, r);
};
const find = async (user: string, name: string) => (await allPlaces(user)).find((p) => p.name === name);

const tacos = async (user: string) => {
  const r = result("Los Tacos No. 1");
  r.places.push({ id: "Katz's", name: "Katz's Deli", lat: 40.722, lng: -73.987, listName: "l" });
  await saveList("https://x/food", user, r);
};

test("users make subcategories inside a category and apply them", async () => {
  const user = "sub-create-apply-000";
  await tacos(user);
  await createSubcategory(user, "food", "lunch special");
  await createSubcategory(user, "food", "gatekeep this");

  await setPlaceSubcategories(user, "Los Tacos No. 1", ["lunch special", "gatekeep this"]);
  await setPlaceSubcategories(user, "Katz's", ["lunch special"]);

  // Still food, and narrowable within food.
  expect(await allPlaces(user, { category: "food" })).toHaveLength(2);
  expect(
    (await allPlaces(user, { category: "food", subcategory: "gatekeep this" })).map((p) => p.name),
  ).toEqual(["Los Tacos No. 1"]);
  expect((await find(user, "Los Tacos No. 1"))?.subcategories).toEqual(["gatekeep this", "lunch special"]);
});

test("a created subcategory exists before anything carries it", async () => {
  const user = "sub-unused-000000000";
  await tacos(user);
  await createSubcategory(user, "food", "date spot");
  expect((await categoryOverview(user)).subcategories).toEqual([
    { parent: "food", name: "date spot", count: 0 },
  ]);
});

test("the same name under two categories is two subcategories", async () => {
  const user = "sub-scoped-names-000";
  await bars(user);
  await tacos(user);
  await createSubcategory(user, "food", "date spot");
  await createSubcategory(user, "drink", "date spot");
  await setPlaceSubcategories(user, "Bar Goto", ["date spot"]);

  expect((await categoryOverview(user)).subcategories).toEqual([
    { parent: "drink", name: "date spot", count: 1 },
    { parent: "food", name: "date spot", count: 0 },
  ]);
  expect(await allPlaces(user, { category: "food", subcategory: "date spot" })).toEqual([]);
});

test("a place only takes subcategories of its own category", async () => {
  const user = "sub-wrong-parent-000";
  await bars(user);
  await createSubcategory(user, "food", "lunch special");
  expect(await setPlaceSubcategories(user, "Bar Goto", ["lunch special"])).toEqual({
    ok: false,
    error: "unknown subcategory",
    names: ["lunch special"],
  });
  expect(await setPlaceSubcategories(user, "not-mine", [])).toEqual({ ok: false, error: "no such place" });
});

test("moving a place hides its old subcategories, and moving back restores them", async () => {
  const user = "sub-move-restore-000";
  await tacos(user);
  await createSubcategory(user, "food", "gatekeep this");
  await setPlaceSubcategories(user, "Los Tacos No. 1", ["gatekeep this"]);

  await setPlaceOverride(user, "Los Tacos No. 1", { category: "drink" });
  expect((await find(user, "Los Tacos No. 1"))?.subcategories).toEqual([]);
  expect((await categoryOverview(user)).subcategories[0]?.count).toBe(0);

  await setPlaceOverride(user, "Los Tacos No. 1", { category: null });
  expect((await find(user, "Los Tacos No. 1"))?.subcategories).toEqual(["gatekeep this"]);
});

test("subcategories survive a refresh of the list", async () => {
  const user = "sub-survive-00000000";
  await tacos(user);
  await createSubcategory(user, "food", "date spot");
  await setPlaceSubcategories(user, "Katz's", ["date spot"]);
  await tacos(user);
  expect((await find(user, "Katz's Deli"))?.subcategories).toEqual(["date spot"]);
});

test("deleting a subcategory takes it off every place", async () => {
  const user = "sub-delete-000000000";
  await tacos(user);
  await createSubcategory(user, "food", "cheap eats");
  await setPlaceSubcategories(user, "Los Tacos No. 1", ["cheap eats"]);
  await setPlaceSubcategories(user, "Katz's", ["cheap eats"]);

  expect(await deleteSubcategory(user, "food", "cheap eats")).toBe(true);
  expect((await find(user, "Katz's Deli"))?.subcategories).toEqual([]);
  expect((await categoryOverview(user)).subcategories).toEqual([]);
  expect(await deleteSubcategory(user, "food", "cheap eats")).toBe(false);
});

test("counts are of places, not list entries", async () => {
  const user = "sub-counts-000000000";
  await bars(user);
  // The same bar in a second list must not double anything.
  await saveList("https://x/other", user, result("Bar Goto"));
  await createSubcategory(user, "drink", "date bar");
  await setPlaceSubcategories(user, "Bar Goto", ["date bar"]);

  const overview = await categoryOverview(user);
  expect(overview.builtIn).toEqual([{ name: "drink", count: 2 }]);
  expect(overview.subcategories).toEqual([{ parent: "drink", name: "date bar", count: 1 }]);
});

test("cuisine and price are set, filtered on, and reset", async () => {
  const user = "cuisine-price-000000";
  await saveList("https://x/food", user, result("Los Tacos No. 1"));
  const taco = async () => await find(user, "Los Tacos No. 1");

  await setPlaceOverride(user, "Los Tacos No. 1", { cuisine: "mexican", price: 1 });
  expect(await taco()).toMatchObject({ cuisine: "mexican", price: 1 });
  expect(await allPlaces(user, { cuisine: "mexican" })).toHaveLength(1);
  expect((await categoryOverview(user)).cuisines).toEqual([{ name: "mexican", count: 1 }]);

  // Changing one field leaves the other alone.
  await setPlaceOverride(user, "Los Tacos No. 1", { price: 2 });
  expect(await taco()).toMatchObject({ cuisine: "mexican", price: 2 });

  await setPlaceOverride(user, "Los Tacos No. 1", { cuisine: null, price: null });
  expect(await taco()).toMatchObject({ cuisine: null, price: null });
});

test("forgetting a user removes their subcategories too", async () => {
  const user = "forget-sub-000000000";
  await bars(user);
  await createSubcategory(user, "drink", "date bar");
  await setPlaceSubcategories(user, "Bar Goto", ["date bar"]);
  await forgetUser(user);
  await bars(user);
  expect((await find(user, "Bar Goto"))?.subcategories).toEqual([]);
  expect((await categoryOverview(user)).subcategories).toEqual([]);
});

test("stored categories follow the current rules, and retired ones reset", async () => {
  const user = "rederive-keywords-00";
  await saveList("https://x/art", user, result("Whitney Museum"));
  // As if saved under an old rule set that still had "culture".
  await sql`UPDATE places SET category = 'culture' WHERE user_key = ${user}`;
  await sql`INSERT INTO place_overrides (user_key, place_id, category)
            VALUES (${user}, 'Whitney Museum', 'culture')`;

  await rederiveKeywordCategories();
  const [place] = await allPlaces(user);
  expect(place?.category).toBe("art");
  expect(place?.categorySource).not.toBe("override");
});
