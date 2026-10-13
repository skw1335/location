import type { Category } from "../categorize";

/**
 * Turns Google's own place categories ("Georgian restaurant", "Cocktail bar")
 * into ours. Google lists the primary category first, so the first one that
 * maps decides the built-in category — and only a place that's food by that
 * measure gets a cuisine. A bar Google also tags "Mexican restaurant" stays a
 * bar.
 */

/** Tried per Google category, in order: specific before vague, "espresso bar" before "bar". */
const CATEGORY_RULES: Array<[Category, RegExp]> = [
  // Before the generic "___ restaurant" rule, which would otherwise claim them.
  ["dessert", /^dessert restaurant$/i],
  // Before "bar": a jazz club is somewhere you go for the music.
  ["music", /\b(jazz|blues) club\b|live music|concert hall|music venue|opera house/i],
  ["shows", /comedy club|theat(er|re)|cinema|performing arts|playhouse/i],
  ["food", /\brestaurant$/i],
  ["coffee", /coffee|caf[eé]\b|espresso|tea ?(house|room)/i],
  ["dessert", /bakery|pastry|p[aâ]tisserie|dessert|ice cream|gelato|donut|doughnut|chocolat|cake shop|frozen yogurt|candy/i],
  ["drink", /\b(bar|pub|brewery|brewpub|taproom|lounge|night ?club|speakeasy|winery|distillery|beer garden|tavern)\b/i],
  ["food", /\b(deli|delicatessen|diner|bistro|eatery|bagel|sandwich|pizzeria|steak ?house|brasserie|trattoria|taqueria|food court|meal takeaway|food)\b/i],
  ["art", /museum|gallery|landmark|monument|sculpture|art cent(er|re)/i],
  ["outdoors", /\b(park|garden|beach|trail|pier|playground|plaza|waterfront)\b/i],
  ["shopping", /store|shop\b|market|boutique|mall|outlet|supermarket/i],
];

export function categoryFromGoogle(googleCategories: string[]): Category | null {
  for (const g of googleCategories) {
    for (const [category, pattern] of CATEGORY_RULES) if (pattern.test(g)) return category;
  }
  return null;
}

/** "___ restaurant" prefixes that say nothing about what's served. */
const NOT_A_CUISINE =
  /^(fast food|family|fine dining|takeout|take out|casual|delivery|buffet|brunch|breakfast|lunch|dinner|small plates|modern|traditional|new american|catering)$/i;

/**
 * Regions rather than cuisines. Used only when nothing more specific is there:
 * "Asian restaurant, Chinese noodle restaurant" should say chinese.
 */
const BROAD = new Set(["asian", "european", "eastern european", "latin american", "south american", "western", "fusion", "asian fusion"]);

/** Google often leads with a dish; the cuisine is what people filter by. */
const DISH_TO_CUISINE: Record<string, string> = {
  taco: "mexican",
  burrito: "mexican",
  "tex-mex": "mexican",
  sushi: "japanese",
  ramen: "japanese",
  udon: "japanese",
  "japanese curry": "japanese",
  "japanese izakaya": "japanese",
  izakaya: "japanese",
  "dim sum": "chinese",
  dumpling: "chinese",
  "hot pot": "chinese",
  cantonese: "chinese",
  mandarin: "chinese",
  szechuan: "chinese",
  sichuan: "chinese",
  "chinese noodle": "chinese",
  pho: "vietnamese",
  falafel: "middle eastern",
  shawarma: "middle eastern",
  kebab: "middle eastern",
  hamburger: "american",
  "korean barbecue": "korean",
  "north indian": "indian",
  "south indian": "indian",
};

/** Food places Google doesn't call "___ restaurant", but whose type is still the answer. */
const FOOD_TYPES: Array<[RegExp, string]> = [
  [/\b(deli|delicatessen)\b/i, "deli"],
  [/\bbagel/i, "bagels"],
  [/\bpizz/i, "pizza"],
  [/\bsandwich/i, "sandwiches"],
  [/\bsteak ?house/i, "steakhouse"],
];

export function cuisineFromGoogle(googleCategories: string[]): string | null {
  if (categoryFromGoogle(googleCategories) !== "food") return null;

  let broad: string | null = null;
  for (const g of googleCategories) {
    const prefix = g.match(/^(.+?) restaurant$/i)?.[1]?.trim().toLowerCase();
    if (!prefix || NOT_A_CUISINE.test(prefix)) continue;
    const cuisine = DISH_TO_CUISINE[prefix] ?? prefix;
    if (!BROAD.has(cuisine)) return cuisine;
    broad ??= cuisine;
  }
  for (const g of googleCategories) {
    for (const [pattern, cuisine] of FOOD_TYPES) if (pattern.test(g)) return cuisine;
  }
  return broad;
}
