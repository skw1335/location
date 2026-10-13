import { expect, test } from "bun:test";
import { byDistance, haversine, walkingMinutes } from "./distance";

// Real NYC places. The code knows nothing about NYC; these just pin it to
// distances anyone can check on a map.
const washingtonSquareArch = { lat: 40.73115, lng: -73.99706 };
const places = [
  { name: "Katz's Delicatessen", lat: 40.72223, lng: -73.98744 },
  { name: "Comedy Cellar", lat: 40.73013, lng: -74.00058 },
  { name: "Empire State Building", lat: 40.74844, lng: -73.98566 },
  { name: "Strand Book Store", lat: 40.73319, lng: -73.99083 },
  { name: "Joe's Pizza Carmine St", lat: 40.73055, lng: -74.00213 },
];

test("haversine matches a known Manhattan distance", () => {
  // Empire State Building to Duffy Square, Times Square: ~12 blocks up 5th/7th, ~1.07 km.
  const m = haversine(40.74844, -73.98566, 40.758, -73.98553);
  expect(m).toBeGreaterThan(1040);
  expect(m).toBeLessThan(1100);
});

test("sorts nearest-first from Washington Square", () => {
  const sorted = byDistance(places, washingtonSquareArch.lat, washingtonSquareArch.lng);
  expect(sorted.map((p) => p.name)).toEqual([
    "Comedy Cellar",
    "Joe's Pizza Carmine St",
    "Strand Book Store",
    "Katz's Delicatessen",
    "Empire State Building",
  ]);
});

test("walking minutes land near real routed walks", () => {
  // Real OSM foot routes from the arch (2026-10-13): Strand 771 m, Katz's 1528 m.
  const [strand, katz] = ["Strand Book Store", "Katz's Delicatessen"].map(
    (name) =>
      byDistance(places, washingtonSquareArch.lat, washingtonSquareArch.lng).find(
        (p) => p.name === name,
      )!,
  );
  expect(strand!.walkMinutes).toBeCloseTo(771 / 80, -0.5);
  expect(katz!.walkMinutes).toBeCloseTo(1528 / 80, -0.5);
});

test("a place on the spot is zero minutes away", () => {
  expect(walkingMinutes(0)).toBe(0);
});
