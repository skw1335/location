import { expect, test } from "bun:test";
import { directionsUrl } from "./maps";

const katz = { name: "Katz's Delicatessen", lat: 40.72223, lng: -73.98744 };
const params = (url: string) => Object.fromEntries(new URL(url).searchParams);

test("uses Google's place id when the server has one", () => {
  const url = directionsUrl({ ...katz, googlePlaceId: "ChIJ0abc" });
  expect(url.startsWith("https://www.google.com/maps/dir/?")).toBe(true);
  expect(params(url)).toEqual({
    api: "1",
    travelmode: "walking",
    destination: "Katz's Delicatessen",
    destination_place_id: "ChIJ0abc",
  });
});

test("falls back to name and address", () => {
  const url = directionsUrl({ ...katz, address: "205 E Houston St, New York, NY 10002" });
  expect(params(url).destination).toBe("Katz's Delicatessen, 205 E Houston St, New York, NY 10002");
});

test("falls back to coordinates when there's nothing else", () => {
  expect(params(directionsUrl(katz)).destination).toBe("40.72223,-73.98744");
});
