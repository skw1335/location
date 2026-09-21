import { saveList, staleLists } from "./db";
import { ingestSharedList } from "./ingest/sharedList";
import type { IngestResult } from "./types";

/** Younger than this, a list is served from cache without touching Google. */
export const STALE_AFTER_MS = 15 * 60 * 1000;

export interface RefreshSummary {
  checked: number;
  changed: number;
  /** Lists whose fetch threw or came back empty; their cached places were kept. */
  failed: number;
}

/**
 * Re-fetches every one of the user's lists that has gone stale.
 *
 * A failed fetch, or one that parses to zero places when we previously had
 * some, leaves the cache untouched: when Google moves a field, the user should
 * see yesterday's places, not a blank screen.
 *
 * `ingest` is injectable so tests don't hit the network.
 */
export async function refreshStale(
  userKey: string,
  ingest: (url: string) => Promise<IngestResult> = ingestSharedList,
): Promise<RefreshSummary> {
  const due = staleLists(userKey, STALE_AFTER_MS);
  const summary: RefreshSummary = { checked: due.length, changed: 0, failed: 0 };

  await Promise.all(
    due.map(async ({ url, count }) => {
      try {
        const result = await ingest(url);
        if (result.places.length === 0 && count > 0) {
          summary.failed++;
          return;
        }
        if (saveList(url, userKey, result)) summary.changed++;
      } catch {
        summary.failed++;
      }
    }),
  );

  return summary;
}
