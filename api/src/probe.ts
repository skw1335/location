/**
 * Exploratory probe for a Google Maps shared list URL.
 *
 * We don't know the page shape yet, so this reports what's there rather than
 * assuming a schema. Dumps the raw HTML to disk so we can grep it by hand.
 *
 *   bun src/probe.ts "https://maps.app.goo.gl/XXXX"
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const url = process.argv[2];
if (!url) {
  console.error('usage: bun src/probe.ts "<shared list url>"');
  process.exit(1);
}

const res = await fetch(url, {
  headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  redirect: "follow",
});
const html = await res.text();

const out = `${process.env.PROBE_OUT ?? "/tmp"}/maps-list.html`;
await Bun.write(out, html);

console.log(`status      ${res.status}`);
console.log(`final url   ${res.url}`);
console.log(`bytes       ${html.length}`);
console.log(`saved       ${out}\n`);

// Google embeds page data in a few well-known globals. See which we got.
for (const key of [
  "APP_INITIALIZATION_STATE",
  "APP_OPTIONS",
  "PRELOADED_STATE",
  "entitylist",
]) {
  console.log(`${html.includes(key) ? "found  " : "absent "} ${key}`);
}

// Any coordinate pair, anywhere on earth — a rough "is the real data in here" signal.
const coords = [...html.matchAll(/(-?\d{1,2}\.\d{5,})\s*,\s*(-?\d{1,3}\.\d{5,})/g)];
console.log(`\ncoord-like pairs: ${coords.length}`);
for (const [, lat, lng] of coords.slice(0, 8)) console.log(`  ${lat}, ${lng}`);

// Place names usually surface in <meta> before anything else does.
for (const m of html.matchAll(/<meta[^>]+(?:property|name)="([^"]+)"[^>]+content="([^"]*)"/g)) {
  const [, prop, content] = m;
  if (/title|description|og:/.test(prop!)) console.log(`\n${prop}\n  ${content?.slice(0, 200)}`);
}
