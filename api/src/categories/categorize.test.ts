import { expect, test } from "bun:test";
import { categorize, isCategory, normalizeLabel } from "./categorize";

test("matches distinctive tokens regardless of word boundaries", () => {
  // Business names run words together and pluralise; both defeated the first
  // implementation, which required strict word boundaries everywhere.
  expect(categorize("King Dumplings").category).toBe("food");
  expect(categorize("Videogamesnewyork").category).toBe("shopping");
  expect(categorize("YellowSun Coffee").category).toBe("coffee");
  expect(categorize("Clinton St. Baking Company").category).toBe("dessert");
});

test("keeps word boundaries on ambiguous short words", () => {
  // The reason short tokens aren't matched loosely.
  expect(categorize("Barcelona Wine Bar").category).toBe("drink");
  expect(categorize("Barnes & Noble").category).not.toBe("drink");
  expect(categorize("Parkside Diner").category).toBe("food");
});

test("a user-named list outranks the place name", () => {
  // "best tacos" describes the whole list better than any single name does.
  expect(categorize("Ankara #3", "best tacos").source).toBe("list");
  expect(categorize("Ankara #3", "best tacos").category).toBe("food");
});

test("Google's stock list names carry no signal", () => {
  for (const generic of ["Want to go", "Favorites", "Starred places", "Saved places"]) {
    expect(categorize("Ankara #3", generic).source).toBe("fallback");
  }
});

test("falls back rather than guessing", () => {
  // Names that genuinely don't say what they are must not be forced into a bucket.
  const r = categorize("Russ & Daughters", "Want to go");
  expect(r.category).toBe("other");
  expect(r.source).toBe("fallback");
});

test("isCategory guards the API surface", () => {
  expect(isCategory("food")).toBe(true);
  expect(isCategory("nonsense")).toBe(false);
  expect(isCategory(null)).toBe(false);
});

test("user categories are normalised so duplicates collapse", () => {
  expect(normalizeLabel("  Date   Bar ")).toBe("date bar");
  expect(normalizeLabel("")).toBeNull();
  expect(normalizeLabel("   ")).toBeNull();
  expect(normalizeLabel("x".repeat(41))).toBeNull();
  expect(normalizeLabel(42)).toBeNull();
});
