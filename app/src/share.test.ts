import { expect, test } from "bun:test";
import { connectLinkFrom, findMapsLink } from "./share";

test("finds the link inside the text Maps shares", () => {
  expect(
    findMapsLink([
      { shareType: "text", value: "Want to go\nhttps://maps.app.goo.gl/QXm7g4aiXu2fUyRv7" },
    ]),
  ).toBe("https://maps.app.goo.gl/QXm7g4aiXu2fUyRv7");
});

test("takes a bare URL share as is", () => {
  const url = "https://www.google.com/maps/placelists/list/n5UgiVOffxTD4pIwUucexuxPiQ1G3A";
  expect(findMapsLink([{ shareType: "url", value: url }])).toBe(url);
});

test("trims punctuation that ends a sentence", () => {
  expect(findMapsLink([{ shareType: "text", value: "Try this (https://maps.app.goo.gl/AbC)." }])).toBe(
    "https://maps.app.goo.gl/AbC",
  );
});

test("ignores anything that isn't a Maps link", () => {
  expect(findMapsLink([{ shareType: "text", value: "see https://example.com/list" }])).toBeNull();
  expect(findMapsLink([{ shareType: "image", value: "file:///x.png" }])).toBeNull();
  expect(findMapsLink([])).toBeNull();
});

test("takes a list from a connect deep link", () => {
  const maps = "https://maps.app.goo.gl/QXm7g4aiXu2fUyRv7";
  const q = encodeURIComponent(maps);
  expect(connectLinkFrom(`location://connect?url=${q}`)).toBe(maps);
  expect(connectLinkFrom(`exp://192.168.1.20:8081/--/connect?url=${q}`)).toBe(maps);
  // The Shortcut may pass along everything Maps shared, not just the link.
  expect(connectLinkFrom(`location://connect?url=${encodeURIComponent(`Want to go\n${maps}`)}`)).toBe(maps);
});

test("ignores other deep links", () => {
  expect(connectLinkFrom(null)).toBeNull();
  expect(connectLinkFrom("exp://192.168.1.20:8081")).toBeNull();
  expect(connectLinkFrom("location://connect")).toBeNull();
  expect(connectLinkFrom("location://other?url=https%3A%2F%2Fmaps.app.goo.gl%2FAbC")).toBeNull();
});
