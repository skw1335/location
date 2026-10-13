import { expect, test } from "bun:test";
import { mapsResponse } from "./fixture";
import { lookUp, nameSimilarity, parseResults, pickMatch } from "./googleMaps";

const chama = { name: "Chama Mama", lat: 40.7068274, lng: -73.932148 };

test("parses place records out of a search response", () => {
  const [first] = parseResults(
    mapsResponse([{ ...chama, categories: ["Georgian restaurant", "Restaurant"], id: "ChIJabc" }]),
  );
  expect(first).toMatchObject({
    name: "Chama Mama",
    categories: ["Georgian restaurant", "Restaurant"],
    googleId: "ChIJabc",
  });
});

test("a response it doesn't understand yields nothing rather than throwing", () => {
  expect(parseResults("<html>enable javascript</html>")).toEqual([]);
  expect(parseResults(`)]}'\n[[null, "not a list"]]`)).toEqual([]);
});

test("names match despite case, punctuation and spacing", () => {
  expect(nameSimilarity("Los Tacos No. 1", "LOS TACOS No.1")).toBeGreaterThanOrEqual(0.5);
  expect(nameSimilarity("Russ & Daughters", "Russ and Daughters")).toBe(1);
  expect(nameSimilarity("Abraço", "Abraco Espresso")).toBe(1);
  expect(nameSimilarity("Abraço", "La Cabra")).toBe(0);
});

test("picks the nearest branch of a chain", () => {
  const branches = [
    { name: "LOS TACOS No.1", categories: ["Taco restaurant"], lat: 40.7407, lng: -73.9873, id: "far" },
    { name: "LOS TACOS No.1", categories: ["Taco restaurant"], lat: 40.74225, lng: -74.00596, id: "near" },
  ];
  const saved = { name: "Los Tacos No. 1", lat: 40.7423, lng: -74.006 };
  expect(pickMatch(saved, parseResults(mapsResponse(branches)))?.googleId).toBe("near");
});

test("rejects a neighbour with a different name, and anything too far away", () => {
  const saved = { name: "Abraço", lat: 40.7272, lng: -73.9845 };
  const nearbyOther = [{ name: "La Cabra", categories: ["Coffee shop"], lat: 40.7273, lng: -73.9846 }];
  expect(pickMatch(saved, parseResults(mapsResponse(nearbyOther)))).toBeNull();

  const farSame = [{ name: "Abraço", categories: ["Coffee shop"], lat: 40.75, lng: -73.98 }];
  expect(pickMatch(saved, parseResults(mapsResponse(farSame)))).toBeNull();
});

test("searches centred on the saved place", async () => {
  let asked = "";
  await lookUp(chama, async (url) => {
    asked = decodeURIComponent(url);
    return mapsResponse([]);
  });
  expect(asked).toContain("q=Chama Mama");
  expect(asked).toContain(`!2d${chama.lng}!3d${chama.lat}`);
});
