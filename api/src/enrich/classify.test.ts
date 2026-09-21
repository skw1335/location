import { expect, test } from "bun:test";
import { categoryFromGoogle, cuisineFromGoogle } from "./classify";

test("reads the cuisine from Google's primary category", () => {
  expect(cuisineFromGoogle(["Georgian restaurant", "Eastern European restaurant", "Restaurant"])).toBe(
    "georgian",
  );
});

test("a dish maps to its cuisine", () => {
  expect(cuisineFromGoogle(["Taco restaurant", "Mexican restaurant"])).toBe("mexican");
  expect(cuisineFromGoogle(["Taco restaurant", "Restaurant"])).toBe("mexican");
  expect(cuisineFromGoogle(["Ramen restaurant"])).toBe("japanese");
});

test("skips categories that don't name a cuisine", () => {
  expect(cuisineFromGoogle(["Fast food restaurant", "Thai restaurant"])).toBe("thai");
  expect(cuisineFromGoogle(["Restaurant"])).toBeNull();
  expect(cuisineFromGoogle(["Cocktail bar", "Bar"])).toBeNull();
});

test("keeps multi-word cuisines whole", () => {
  expect(cuisineFromGoogle(["Middle Eastern restaurant"])).toBe("middle eastern");
});

// Straight from a real list, 2026-09-21: every one of these the keyword rules got wrong.
test("Google's primary category decides the built-in", () => {
  expect(categoryFromGoogle(["Tibetan restaurant"])).toBe("food");
  expect(categoryFromGoogle(["Bar"])).toBe("drink");
  expect(categoryFromGoogle(["Bagel shop", "Bakery", "Deli"])).toBe("food");
  expect(categoryFromGoogle(["American restaurant", "Bakery", "Breakfast restaurant"])).toBe("food");
  expect(categoryFromGoogle(["Coffee shop"])).toBe("coffee");
  expect(categoryFromGoogle(["Cafe", "Bar", "Restaurant"])).toBe("coffee");
  expect(categoryFromGoogle(["Video game store", "Electronics store"])).toBe("shopping");
  expect(categoryFromGoogle(["City park", "Playground"])).toBe("outdoors");
  expect(categoryFromGoogle(["Car wash"])).toBeNull();
});

test("only food gets a cuisine — a bar that also serves tacos stays a bar", () => {
  expect(cuisineFromGoogle(["Cocktail bar", "Mexican restaurant"])).toBeNull();
  expect(cuisineFromGoogle(["Coffee shop", "Italian restaurant"])).toBeNull();
});

test("a specific cuisine beats a regional one, wherever it's listed", () => {
  expect(cuisineFromGoogle(["Restaurant", "Asian restaurant", "Chinese noodle restaurant"])).toBe("chinese");
  expect(cuisineFromGoogle(["Georgian restaurant", "Eastern European restaurant"])).toBe("georgian");
  expect(cuisineFromGoogle(["Asian restaurant"])).toBe("asian");
});

test("food places that aren't '___ restaurant' still get a cuisine when the type says it", () => {
  expect(cuisineFromGoogle(["Deli"])).toBe("deli");
  expect(cuisineFromGoogle(["Bagel shop", "Bakery", "Deli", "Jewish restaurant"])).toBe("jewish");
  expect(cuisineFromGoogle(["Bagel shop", "Bakery"])).toBe("bagels");
  expect(cuisineFromGoogle(["Restaurant"])).toBeNull();
});

// From 120 random NYC spots, 2026-09-21.
test("music venues are music even when Google also calls them bars", () => {
  expect(categoryFromGoogle(["Jazz club"])).toBe("music");
  expect(categoryFromGoogle(["Jazz club", "Bar"])).toBe("music");
  expect(categoryFromGoogle(["Blues club"])).toBe("music");
  expect(categoryFromGoogle(["Jazz club", "Cocktail bar", "Live music venue"])).toBe("music");
  // Primary category still wins: a bar that hosts jazz is a bar.
  expect(categoryFromGoogle(["Bar", "Cocktail bar", "Jazz club"])).toBe("drink");
});

test("museums and galleries are art; theaters, comedy and cinemas are shows", () => {
  expect(categoryFromGoogle(["Art museum", "Museum"])).toBe("art");
  expect(categoryFromGoogle(["Art gallery"])).toBe("art");
  expect(categoryFromGoogle(["Historical landmark"])).toBe("art");
  expect(categoryFromGoogle(["Comedy club", "Bar"])).toBe("shows");
  expect(categoryFromGoogle(["Movie theater"])).toBe("shows");
  expect(categoryFromGoogle(["Performing arts theater"])).toBe("shows");
});

test("a dessert restaurant is dessert, with no cuisine", () => {
  expect(categoryFromGoogle(["Dessert restaurant", "Coffee shop"])).toBe("dessert");
  expect(cuisineFromGoogle(["Dessert restaurant", "Coffee shop"])).toBeNull();
});
