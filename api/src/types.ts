/** A saved place, normalised across whatever ingestion path produced it. */
export interface Place {
  /** Stable across refetches: Google's place id when we have it, else name+coords. */
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  /** The user's own note on the place, if they wrote one. */
  note?: string;
  /** Name of the list this came from — often the best category signal we get. */
  listName: string;
  /** Derived server-side; absent until the place has been through ingest. */
  category?: string;
  /** "override" | "google" | "list" | "name" | "fallback" — how much to trust `category`. */
  categorySource?: string;
  /**
   * Facts rather than opinions, so each has one answer: a restaurant serves
   * one cuisine and has one price level (1–4, "$" to "$$$$").
   */
  cuisine?: string | null;
  /** "override" | "google" | "derived", or null when there's no cuisine. */
  cuisineSource?: string | null;
  price?: number | null;
  /** The user's own subcategories of `category`: "lunch special", "date spot". */
  subcategories?: string[];
  /** Google's place id (ChIJ…) once looked up; null until then. */
  googlePlaceId?: string | null;
}

/** Result of ingesting one source, with enough detail to debug a bad parse. */
export interface IngestResult {
  places: Place[];
  /** Which extraction strategy actually worked, for when Google changes the page. */
  strategy: string;
  listName: string;
  fetchedAt: number;
}

/** A connected list, as the app shows it. */
export interface SavedList {
  url: string;
  name: string;
  count: number;
}
