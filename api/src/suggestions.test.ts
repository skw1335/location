import { expect, test } from "bun:test";
import { suggestionsFor } from "./suggestions";

test("starter ideas drop out once the user has created them under that category", () => {
  const { subcategories } = suggestionsFor({
    subcategories: [{ parent: "food", name: "lunch special", count: 2 }],
    cuisines: [],
  });
  expect(subcategories.food).toContain("date spot");
  expect(subcategories.food).not.toContain("lunch special");
});

test("creating a name under one category doesn't hide it as an idea for another", () => {
  const { subcategories } = suggestionsFor({
    subcategories: [{ parent: "food", name: "late night", count: 0 }],
    cuisines: [],
  });
  expect(subcategories.dessert).toContain("late night");
});

test("cuisines the user has used come first", () => {
  const { cuisines } = suggestionsFor({ subcategories: [], cuisines: [{ name: "georgian", count: 1 }] });
  expect(cuisines[0]).toBe("georgian");
  expect(cuisines).toContain("mexican");
});
