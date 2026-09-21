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
  /** "list" | "name" | "fallback" | "override" — how much to trust `category`. */
  categorySource?: string;
}

/** Result of ingesting one source, with enough detail to debug a bad parse. */
export interface IngestResult {
  places: Place[];
  /** Which extraction strategy actually worked, for when Google changes the page. */
  strategy: string;
  listName: string;
  fetchedAt: number;
}

/**
 * A set of people who see the same lists. A solo user's own places are just a
 * group of one, flagged `personal` so the UI can present it without ceremony.
 */
export interface Group {
  id: string;
  name: string;
  /** Short, human-typeable, unambiguous. How someone else joins. */
  inviteCode: string;
  members: number;
  personal: boolean;
}

/** A connected list, annotated with which group it reaches the user through. */
export interface SavedList {
  url: string;
  name: string;
  count: number;
  groupName: string;
  /** False when it's the user's own — drives whether the UI shows attribution. */
  shared: boolean;
}
