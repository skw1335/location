import { placesToLookUp, rederiveLookups, saveLookup } from "../db";
import { categoryFromGoogle, cuisineFromGoogle } from "./classify";
import { type Fetcher, lookUp } from "./googleMaps";

/**
 * Looks places up on Google Maps in the background, a few at a time.
 *
 * Deliberately slow: one request every 1.5s, at most 40 per run. This is an
 * unofficial endpoint, and a burst of hundreds of searches is exactly what
 * gets an IP blocked — for this *and* for list ingest, which shares the host.
 * Whatever a run doesn't reach, the next one picks up.
 */
const GAP_MS = 1500;
const PER_RUN = 40;

/** Google's categories → our category and cuisine. Pure, so it can be re-run over stored lookups. */
export const derive = (googleCategories: string[]) => ({
  category: categoryFromGoogle(googleCategories),
  cuisine: cuisineFromGoogle(googleCategories),
});

/** Applies the current mapping rules to everything already looked up. */
export const rederive = () => rederiveLookups(derive);

let running: Promise<LookupSummary> | null = null;

export interface LookupSummary {
  matched: number;
  missed: number;
  failed: number;
}

export function lookUpPending(
  options: { fetcher?: Fetcher; gapMs?: number; limit?: number } = {},
): Promise<LookupSummary> {
  // Refreshes and connects both kick this off; never run two at once.
  running ??= run(options).finally(() => {
    running = null;
  });
  return running;
}

async function run({
  fetcher,
  gapMs = GAP_MS,
  limit = PER_RUN,
}: { fetcher?: Fetcher; gapMs?: number; limit?: number }): Promise<LookupSummary> {
  const summary: LookupSummary = { matched: 0, missed: 0, failed: 0 };
  const due = placesToLookUp(limit);

  for (const [i, place] of due.entries()) {
    if (i > 0 && gapMs) await Bun.sleep(gapMs);
    try {
      const match = await lookUp(place, fetcher);
      if (!match) {
        saveLookup(place.id, { status: "no_match" });
        summary.missed++;
        continue;
      }
      saveLookup(place.id, {
        status: "matched",
        googleId: match.googleId,
        googleCategories: match.categories,
        ...derive(match.categories),
      });
      summary.matched++;
    } catch {
      saveLookup(place.id, { status: "error" });
      summary.failed++;
    }
  }

  if (due.length) console.log(`lookups: ${JSON.stringify(summary)}`);
  return summary;
}
