/**
 * Assigns a category to a saved place.
 *
 * Google's getlist payload carries **no category data at all** — verified
 * against a real list, the only type-ish strings in it are the places' own
 * names. So categories have to be inferred, and inference here is deliberately
 * dumb: keyword rules over the name and the list it came from.
 *
 * This is a floor, not a ceiling. Expect it to whiff on any place whose name
 * doesn't say what it is ("Russ & Daughters", "Ayat", "Good Thanks LES") — no
 * string rule recovers those. The accurate fix is Places API enrichment keyed
 * on the place id we already store, which costs money and needs a key; until
 * then the manual override is the real answer and `source` below tells the UI
 * how much to trust itself.
 *
 * Rules are ordered: the first match wins, so put the specific above the vague.
 */

export const CATEGORIES = [
  "food",
  "coffee",
  "drink",
  "dessert",
  "shopping",
  "outdoors",
  "art",
  "music",
  "shows",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const isCategory = (v: unknown): v is Category =>
  typeof v === "string" && (CATEGORIES as readonly string[]).includes(v);

/**
 * Normalises anything the user types as a label — a category of their own, a
 * tag like "date night", a cuisine — so "Date  Night" and "date night" are one
 * chip, not two. Returns null for anything unusable.
 */
export function normalizeLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return label.length >= 1 && label.length <= 40 ? label : null;
}

/**
 * Long, distinctive tokens — safe to match anywhere in the string, because
 * business names run words together ("Videogamesnewyork") and pluralise
 * ("King Dumplings"). Nothing here collides with ordinary English.
 */
const LOOSE: Array<[Category, RegExp]> = [
  ["coffee", /coffee|espresso|roaster|caffe|café|cafe(?!teria)/i],
  ["dessert", /bakery|baking|patisserie|p[aâ]tisserie|dessert|gelato|ice ?cream|donut|doughnut|creamery|chocolat|cookie/i],
  ["drink", /brewery|brewing|taproom|cocktail|winery|distillery|speakeasy|tavern/i],
  [
    "food",
    /restaurant|dumpling|pizzeria|pizza|taqueria|sushi|ramen|noodle|barbecue|bistro|trattoria|osteria|cuisine|eatery|kitchen|burger|sandwich|szechuan|sichuan|kebab|izakaya|steakhouse|seafood|falafel|shawarma|empanada|pierogi/i,
  ],
  ["shopping", /videogame|bookstore|grocer|boutique|bodega|vintage|thrift/i],
  ["outdoors", /botanical|greenway|playground|waterfront/i],
  ["art", /museum|gallery/i],
  ["shows", /theater|theatre|cinema|playhouse/i],
];

/**
 * Short or ambiguous words — must stand alone as a word, or "bar" matches
 * Barcelona and "deli" matches Delicatessen-adjacent nonsense.
 */
const STRICT: Array<[Category, RegExp]> = [
  ["drink", /\b(bar|pub|wine|lounge|beer|ale ?house)\b/i],
  ["food", /\b(taco|tacos|deli|diner|grill|bbq|thai|halal|curry|dosa|pho|banh|katsu|oyster|ramen)\b/i],
  ["shopping", /\b(store|shop|shops|market|books?|record|records|games?)\b/i],
  ["outdoors", /\b(park|garden|gardens|beach|trail|pier)\b/i],
  ["music", /\b(jazz|blues|concert|venue)\b/i],
  ["shows", /\bcomedy\b/i],
];

/** Loose rules run first — a specific signal beats a generic one. */
const RULES: Array<[Category, RegExp]> = [...LOOSE, ...STRICT];

/**
 * List names are strong signal when the user made the list themselves — "best
 * tacos" beats anything derivable from a place name. Google's stock list names
 * carry no meaning, so they're skipped rather than matched against.
 */
const GENERIC_LISTS = /^(want to go|favou?rites|starred places|saved places|travel plans|labeled)$/i;

export interface Categorized {
  category: Category;
  /** Where the guess came from, so the UI can flag what's worth correcting. */
  source: "list" | "name" | "fallback";
}

export function categorize(name: string, listName = ""): Categorized {
  // A user-named list describes everything in it, so it outranks the place name.
  if (listName && !GENERIC_LISTS.test(listName.trim())) {
    for (const [category, pattern] of RULES) {
      if (pattern.test(listName)) return { category, source: "list" };
    }
  }

  for (const [category, pattern] of RULES) {
    if (pattern.test(name)) return { category, source: "name" };
  }

  return { category: "other", source: "fallback" };
}
