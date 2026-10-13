import type { Count, Subcategory } from "./overview";

/**
 * Ideas for subcategories, per built-in. Everyone's idea of a "date spot"
 * differs, so these are only a nudge: they're offered until the user creates
 * them, and never applied automatically.
 */
const STARTERS: Record<string, string[]> = {
  drink: ["date bar", "sports bar", "dive bar", "cocktail bar", "wine bar", "pregame", "rooftop"],
  food: ["date spot", "lunch special", "gatekeep this", "cheap eats", "group dinner", "brunch"],
  coffee: ["work-friendly", "grab and go", "good pastries"],
  dessert: ["late night", "worth the line"],
  shopping: ["gifts", "browse"],
  outdoors: ["picnic", "run", "sunset"],
  art: ["rainy day", "free days", "photography"],
  music: ["jazz", "late night", "free shows"],
  shows: ["comedy", "date night", "cheap tickets"],
};

/**
 * Unlike a subcategory, a cuisine is a fact with one answer, so
 * this is a list to pick from. The user can still type one that isn't here.
 */
const COMMON_CUISINES = [
  "american",
  "chinese",
  "french",
  "indian",
  "italian",
  "japanese",
  "korean",
  "mediterranean",
  "mexican",
  "middle eastern",
  "pizza",
  "thai",
  "vietnamese",
];

export function suggestionsFor(overview: { subcategories: Subcategory[]; cuisines: Count[] }): {
  /** Per built-in: starter subcategories the user hasn't created under it yet. */
  subcategories: Record<string, string[]>;
  /** Cuisines the user has used (most used first), then common ones. */
  cuisines: string[];
} {
  const created = (parent: string, name: string) =>
    overview.subcategories.some((c) => c.parent === parent && c.name === name);
  const subcategories = Object.fromEntries(
    Object.entries(STARTERS).map(([parent, names]) => [
      parent,
      names.filter((n) => !created(parent, n)),
    ]),
  );
  const used = overview.cuisines.map((c) => c.name);
  return { subcategories, cuisines: [...used, ...COMMON_CUISINES.filter((c) => !used.includes(c))] };
}
