/**
 * Hands navigation to Google Maps. The app is for seeing what's near; getting
 * there is Google's job, so a tap opens walking directions and nothing more.
 *
 * A universal link rather than `comgooglemaps://`: it opens the Google Maps
 * app when installed and the website otherwise, with no Info.plist setup.
 */
export function directionsUrl(place: {
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  googlePlaceId?: string | null;
}): string {
  const params = new URLSearchParams({ api: "1", travelmode: "walking" });
  if (place.googlePlaceId) {
    // Maps requires a destination alongside the id; the id decides the place.
    params.set("destination", place.name);
    params.set("destination_place_id", place.googlePlaceId);
  } else if (place.address) {
    params.set("destination", `${place.name}, ${place.address}`);
  } else {
    // Not looked up yet and no address: coordinates at least land on the spot.
    params.set("destination", `${place.lat},${place.lng}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
