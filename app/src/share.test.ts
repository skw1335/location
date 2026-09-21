import { expect, test } from "bun:test";
import { findMapsLink } from "./share";

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
