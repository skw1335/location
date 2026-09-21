import { expect, test } from "bun:test";
import type { IngestResult, Place } from "./types";

// db.ts opens its database at import time, so the path has to be set first.
process.env.DB_PATH = `/tmp/location-test-${crypto.randomUUID()}.sqlite`;

const { allPlaces, saveList } = await import("./db");
const { refreshStale, STALE_AFTER_MS } = await import("./sync");

const place = (name: string): Place => ({ id: name, name, lat: 40.7, lng: -73.9, listName: "" });

const result = (names: string[], fetchedAt = Date.now()): IngestResult => ({
  places: names.map(place),
  strategy: "test",
  listName: "Want to go",
  fetchedAt,
});

const longAgo = () => Date.now() - STALE_AFTER_MS - 1000;
const names = (userKey: string) => allPlaces(userKey).map((p) => p.name).sort();

test("stale lists pick up new places", async () => {
  const user = "sync-new-places-0000";
  saveList("https://x/a", user, result(["one"], longAgo()));

  const summary = await refreshStale(user, async () => result(["one", "two"]));

  expect(summary).toEqual({ checked: 1, changed: 1, failed: 0 });
  expect(names(user)).toEqual(["one", "two"]);
});

test("fresh lists aren't fetched at all", async () => {
  const user = "sync-fresh-000000000";
  saveList("https://x/a", user, result(["one"]));

  let calls = 0;
  const summary = await refreshStale(user, async () => (calls++, result(["one"])));

  expect(calls).toBe(0);
  expect(summary.checked).toBe(0);
});

test("an unchanged list counts as checked, not changed", async () => {
  const user = "sync-unchanged-00000";
  saveList("https://x/a", user, result(["one"], longAgo()));

  const summary = await refreshStale(user, async () => result(["one"]));

  expect(summary).toEqual({ checked: 1, changed: 0, failed: 0 });
  // The timestamp still moved, so the next open doesn't refetch.
  expect((await refreshStale(user, async () => result(["one"]))).checked).toBe(0);
});

test("a broken parse keeps yesterday's places", async () => {
  const user = "sync-broken-parse-00";
  saveList("https://x/a", user, result(["one", "two"], longAgo()));

  const summary = await refreshStale(user, async () => result([]));

  expect(summary.failed).toBe(1);
  expect(names(user)).toEqual(["one", "two"]);
});

test("a failed fetch keeps yesterday's places", async () => {
  const user = "sync-fetch-fails-000";
  saveList("https://x/a", user, result(["one"], longAgo()));

  const summary = await refreshStale(user, async () => {
    throw new Error("502");
  });

  expect(summary.failed).toBe(1);
  expect(names(user)).toEqual(["one"]);
});
