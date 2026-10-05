/*
 * Staging with a pretend Mapbox. No Mapbox token lives locally (it's only on
 * Railway), so geocoding, Optimize Route and Reverse all fail on staging. Run
 * the server through this file instead (the "sound-staging-mapstub" launch
 * config) and every api.mapbox.com call is answered here:
 *   - geocoding places an address at a spot near downtown Seattle, nudged by
 *     the text so different addresses get different pins;
 *   - Optimized Trips keeps the stops in the order given;
 *   - Directions makes every leg 1 km and 3 minutes;
 *   - the static map image is a 404, so the packet prints without one.
 * Nothing here runs in production: it sets the token itself and is only ever
 * the entry point of this launch config.
 *   tsx --env-file=.env --env-file=.env.staging scripts/staging-mapbox-stub.ts
 */
process.env.MAPBOX_ACCESS_TOKEN = "staging-stub";

const realFetch = globalThis.fetch;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

const hash = (s: string) => Array.from(s).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const coordsOf = (path: string): number[][] =>
  path.split(";").map((pair) => pair.split(",").map(Number));
const legsFor = (n: number) => Array.from({ length: Math.max(n - 1, 0) }, () => ({ distance: 1000, duration: 180 }));

globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (!url.startsWith("https://api.mapbox.com/")) return realFetch(input, init);
  const { pathname } = new URL(url);

  const geocode = pathname.match(/^\/geocoding\/v5\/mapbox\.places\/(.+)\.json$/);
  if (geocode) {
    const address = decodeURIComponent(geocode[1]);
    const h = hash(address);
    const latitude = 47.6062 + ((h % 1000) - 500) / 10000;
    const longitude = -122.3321 + (((h >> 10) % 1000) - 500) / 10000;
    console.log(`[MAPBOX STUB] geocode "${address}" -> ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`);
    return json({
      features: [{
        center: [longitude, latitude],
        place_name: `${address} (stub)`,
        context: [{ id: "place.1", text: "Seattle" }, { id: "region.1", short_code: "US-WA" }, { id: "postcode.1", text: "98101" }],
      }],
    });
  }

  const trips = pathname.match(/^\/optimized-trips\/v1\/mapbox\/driving\/(.+)$/);
  if (trips) {
    const coordinates = coordsOf(trips[1]);
    console.log(`[MAPBOX STUB] optimize ${coordinates.length} points, given order kept`);
    return json({
      code: "Ok",
      trips: [{ distance: 1000 * (coordinates.length - 1), duration: 180 * (coordinates.length - 1), geometry: { type: "LineString", coordinates }, legs: legsFor(coordinates.length) }],
      waypoints: coordinates.map((_, i) => ({ waypoint_index: i, trips_index: 0 })),
    });
  }

  const directions = pathname.match(/^\/directions\/v5\/mapbox\/driving\/(.+)$/);
  if (directions) {
    const coordinates = coordsOf(directions[1]);
    console.log(`[MAPBOX STUB] directions over ${coordinates.length} points`);
    return json({
      code: "Ok",
      routes: [{ distance: 1000 * (coordinates.length - 1), duration: 180 * (coordinates.length - 1), geometry: { type: "LineString", coordinates }, legs: legsFor(coordinates.length) }],
    });
  }

  console.log(`[MAPBOX STUB] no stand-in for ${pathname}: 404`);
  return new Response(null, { status: 404, statusText: "stubbed" });
}) as typeof fetch;

await import("../server/index");
