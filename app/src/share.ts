import type { SharePayload } from "expo-sharing";

/**
 * Google Maps shares a list as text with the link somewhere inside it
 * ("Check out this list… https://maps.app.goo.gl/AbC"), or as a bare URL,
 * depending on platform and version. Either way, pull out the first link that
 * could be a list. The API does the real check when it resolves the link.
 */
const MAPS_LINK =
  /https?:\/\/(?:maps\.app\.goo\.gl\/[^\s"'<>]+|(?:www\.)?google\.[a-z.]+\/maps\/[^\s"'<>]+|goo\.gl\/maps\/[^\s"'<>]+)/i;

export function findMapsLink(payloads: SharePayload[]): string | null {
  for (const p of payloads) {
    if (p.shareType !== "text" && p.shareType !== "url") continue;
    const match = p.value?.match(MAPS_LINK);
    if (match) return match[0].replace(/[).,;]+$/, "");
  }
  return null;
}

/**
 * Lists can also arrive by deep link — `location://connect?url=…`, or in Expo
 * Go `exp://<host>:8081/--/connect?url=…` — which is how the iOS Shortcut
 * workaround hands one over without a paid share extension. `url` may be the
 * whole text Maps shared, so the link is dug out the same way as a share.
 */
export function connectLinkFrom(deepLink: string | null): string | null {
  if (!deepLink) return null;
  let parsed: URL;
  try {
    parsed = new URL(deepLink);
  } catch {
    return null;
  }
  const route = `${parsed.host}${parsed.pathname}`.replace(/\/+$/, "");
  if (!route.endsWith("connect")) return null;
  const shared = parsed.searchParams.get("url");
  return shared ? findMapsLink([{ shareType: "text", value: shared }]) : null;
}
