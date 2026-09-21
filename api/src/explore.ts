/// <reference lib="dom" />
/**
 * Browser-driven exploration of a Google Maps shared list.
 *
 * Two jobs, in order of how long they stay useful:
 *
 *   1. Resolve what a `maps.app.goo.gl` short link actually points at. The
 *      short link is a `DurableDeepLinkUi` interstitial — it does NOT issue an
 *      HTTP redirect, so a plain fetch parks on the interstitial forever. Only
 *      JS knows the destination.
 *   2. Log every request Maps makes while the list renders, so we can find the
 *      XHR that carries the places. That endpoint is the real prize: once we
 *      know its shape we drop to a plain fetch and delete this file.
 *
 * This is a probe, not production. It reports what it sees and asserts nothing.
 *
 *   bun src/explore.ts "https://maps.app.goo.gl/XXXX"
 */

import puppeteer, { type HTTPRequest } from "puppeteer";

const url = process.argv[2];
if (!url) {
  console.error('usage: bun src/explore.ts "<shared list url>"');
  process.exit(1);
}

const OUT = process.env.PROBE_OUT ?? "/tmp";

// Endpoints worth a closer look. `entitylist` is the token seen in the Maps
// shell; the rest are the usual carriers of list payloads.
const INTERESTING = /entitylist|getlist|preview\/place|search|locationsharing|@/;

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 2000 });

  const requests: Array<{ method: string; url: string; type: string }> = [];
  page.on("request", (req: HTTPRequest) => {
    requests.push({ method: req.method(), url: req.url(), type: req.resourceType() });
  });

  // Responses that actually carried a body worth reading.
  const bodies: Array<{ url: string; status: number; bytes: number; head: string }> = [];
  page.on("response", async (res) => {
    const u = res.url();
    if (!INTERESTING.test(u)) return;
    const type = res.headers()["content-type"] ?? "";
    if (!/json|javascript|text/.test(type)) return;
    try {
      const body = await res.text();
      if (body.length < 200) return;
      bodies.push({ url: u, status: res.status(), bytes: body.length, head: body.slice(0, 300) });
      await Bun.write(`${OUT}/xhr-${bodies.length}.txt`, `${u}\n\n${body}`);
    } catch {
      // Body already consumed or the request was aborted — not worth failing over.
    }
  });

  console.log(`opening  ${url}`);
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60_000 });

  // The interstitial hops to the real URL via JS, so settle before reading.
  await new Promise((r) => setTimeout(r, 5000));

  console.log(`landed   ${page.url()}\n`);

  const html = await page.content();
  await Bun.write(`${OUT}/rendered.html`, html);
  console.log(`rendered ${html.length} bytes -> ${OUT}/rendered.html`);

  await page.screenshot({ path: `${OUT}/list.png`, fullPage: false });
  console.log(`shot     ${OUT}/list.png\n`);

  // What did the page ask for that looked like list data?
  const hits = requests.filter((r) => INTERESTING.test(r.url));
  console.log(`=== ${hits.length} interesting requests (of ${requests.length}) ===`);
  for (const r of hits.slice(0, 25)) console.log(`  ${r.method} ${r.url.slice(0, 180)}`);

  console.log(`\n=== ${bodies.length} captured bodies ===`);
  for (const [i, b] of bodies.entries()) {
    console.log(`\n[${i + 1}] ${b.status} ${b.bytes}B  ${b.url.slice(0, 160)}`);
    console.log(`    ${b.head.replace(/\s+/g, " ").slice(0, 200)}`);
  }

  // Rough "is the real data here" signal, same as the plain-fetch probe.
  const coords = [...html.matchAll(/(-?\d{1,2}\.\d{5,})\s*,\s*(-?\d{1,3}\.\d{5,})/g)];
  console.log(`\ncoord-like pairs in DOM: ${coords.length}`);

  // Whatever the list renders as, it should at least surface as headings/links.
  const texts = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll("h1, h2, h3, a[href*='/maps/place/']")) {
      const t = (el.textContent ?? "").trim();
      if (t) out.push(`${el.tagName}: ${t.slice(0, 80)}`);
    }
    return out.slice(0, 40);
  });
  console.log(`\n=== ${texts.length} headings / place links ===`);
  for (const t of texts) console.log(`  ${t}`);
} finally {
  await browser.close();
}
