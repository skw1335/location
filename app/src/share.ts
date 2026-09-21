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
