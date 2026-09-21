import { expect, test } from "bun:test";
import type { IngestResult } from "./types";

// db.ts opens its database at import time, so the path has to be set first.
process.env.DB_PATH = `/tmp/location-test-${crypto.randomUUID()}.sqlite`;

const {
  allPlaces,
  createGroup,
  forgetUser,
  groupsFor,
  isMember,
  joinByInvite,
  personalGroup,
  saveList,
  savedLists,
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
  saveList("https://x/alice", personalGroup(alice).id, result("alice-spot"));

  expect(allPlaces(alice).map((p) => p.name)).toEqual(["alice-spot"]);
  expect(allPlaces(bob)).toEqual([]);
});

test("personal group is minted once and reused", () => {
  expect(personalGroup(alice).id).toBe(personalGroup(alice).id);
  expect(personalGroup(alice).personal).toBe(true);
});

test("joining a group shares its places both ways", () => {
  const group = createGroup(alice, "Weekend");
  saveList("https://x/shared", group.id, result("taco-place"));

  expect(allPlaces(bob)).toEqual([]);

  const joined = joinByInvite(bob, group.inviteCode);
  expect(joined?.id).toBe(group.id);
  expect(joined?.members).toBe(2);

  expect(allPlaces(bob).map((p) => p.name)).toContain("taco-place");
  // Bob sees the shared place but still not Alice's personal one.
  expect(allPlaces(bob).map((p) => p.name)).not.toContain("alice-spot");
});

test("invite codes are unambiguous to read aloud", () => {
  const { inviteCode } = createGroup(alice, "Codes");
  expect(inviteCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/);
});

test("a bad invite code joins nothing", () => {
  expect(joinByInvite(bob, "NOTACODE")).toBeNull();
  expect(isMember(bob, "nonexistent-group")).toBe(false);
});

test("personal groups can't be joined by code", () => {
  const mine = personalGroup(alice);
  expect(joinByInvite(bob, mine.inviteCode)).toBeNull();
});

test("shared lists are labelled with the group they came through", () => {
  const lists = savedLists(bob);
  const shared = lists.find((l) => l.name === "taco-place's list");
  expect(shared?.shared).toBe(true);
  expect(shared?.groupName).toBe("Weekend");
});

test("forgetting a user leaves their groupmates' places intact", () => {
  const before = allPlaces(alice).length;
  expect(before).toBeGreaterThan(0);

  forgetUser(bob);

  // Bob is gone; Alice's shared group survives with her places in it.
  expect(allPlaces(bob)).toEqual([]);
  expect(groupsFor(bob)).toEqual([]);
  expect(allPlaces(alice).map((p) => p.name)).toContain("taco-place");
});
