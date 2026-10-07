const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

interface GeocodingResult {
  latitude: number;
  longitude: number;
  placeName: string;
  // Parsed from Mapbox's result so callers can backfill address fields a person
  // left blank — and so a wrong geocode is visible on screen instead of silent.
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

interface OptimizedStop {
  stopIndex: number;
  waypointIndex: number;
  arrivalTime?: string;
  departureTime?: string;
  distanceFromPrevious?: number;
  durationFromPrevious?: number;
}

interface OptimizedRoute {
  stops: OptimizedStop[];
  totalDuration: number;
  totalDistance: number;
  geometry?: {
    type: string;
    coordinates: number[][];
  };
}

export async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zipCode: string
): Promise<GeocodingResult | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error("Mapbox access token not configured");
    return null;
  }

  // Blank parts are left out rather than sent as ", ,": every customer is in the
  // Pacific Northwest, so a street with no city is biased toward Seattle instead of
  // matching the same street name anywhere in the country (the address autofill
  // uses the same proximity).
  const fullAddress = [address, city, [state, zipCode].filter((s) => s?.trim()).join(" ")]
    .map((s) => s?.trim())
    .filter(Boolean)
    .join(", ");
  const encodedAddress = encodeURIComponent(fullAddress);

  try {
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${MAPBOX_ACCESS_TOKEN}&country=US&limit=1&proximity=-122.3321,47.6062`
    );

    if (!response.ok) {
      console.error(`Geocoding failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (!data.features || data.features.length === 0) {
      console.warn(`No geocoding results for: ${fullAddress}`);
      return null;
    }

    const feature = data.features[0];
    const [longitude, latitude] = feature.center;
    const ctx: any[] = feature.context || [];
    const byType = (t: string) => ctx.find((c) => String(c.id || "").startsWith(t + "."));
    const region = byType("region");

    return {
      latitude,
      longitude,
      placeName: feature.place_name,
      city: byType("place")?.text ?? null,
      state: region?.short_code ? String(region.short_code).replace(/^US-/, "") : null,
      zipCode: byType("postcode")?.text ?? null,
    };
  } catch (error) {
    console.error("Geocoding error:", error);
    return null;
  }
}

const FACILITY_LOCATION = {
  address: "4501 Shilshole Ave NW",
  city: "Seattle",
  state: "WA",
  zipCode: "98107",
  latitude: 47.6694,
  longitude: -122.3894,
};

export function getFacilityLocation() {
  return FACILITY_LOCATION;
}

/** Mapbox turned the route down — too many stops, no road to one of them, a bad
 *  token — or couldn't be reached. Carries the reason so the Routes page shows
 *  it instead of a bare "Failed to optimize route". */
export class RouteOptimizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteOptimizationError";
  }
}

// Optimized Trips v1 takes at most 12 coordinates a request: start, end and ten
// stops. An eleven-stop day (2026-10-07) hit that wall and the page showed a
// bare 500. Days of 11 to 23 stops now get their drive order from the Matrix
// API (25 coordinates) and a local tour search; the drawn line and the legs
// come from Directions over the chosen order.
const OPTIMIZED_TRIPS_MAX_COORDINATES = 12;
const MATRIX_MAX_COORDINATES = 25;
export const MAX_ROUTE_STOPS = MATRIX_MAX_COORDINATES - 2;

type Point = { latitude: number; longitude: number };

const coordinatePath = (points: Point[]) => points.map((p) => `${p.longitude},${p.latitude}`).join(";");

/** Mapbox's own words for a failed response, for the error shown to staff. */
async function mapboxDetail(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.message || parsed.code || text;
  } catch {
    return text || response.statusText;
  }
}

export async function optimizeDeliveryRoute(
  stops: Array<{
    id: string;
    latitude: number;
    longitude: number;
    name: string;
    address: string;
    type: "order" | "custom" | "visit";
  }>,
  // Route endpoints — default to the brewery on both ends.
  endpoints?: { start?: { latitude: number; longitude: number }; end?: { latitude: number; longitude: number } }
): Promise<OptimizedRoute | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error("Mapbox access token not configured");
    return null;
  }

  if (stops.length === 0) {
    return { stops: [], totalDuration: 0, totalDistance: 0 };
  }

  const facility = getFacilityLocation();
  const start = endpoints?.start ?? facility;
  const end = endpoints?.end ?? facility;
  const points: Point[] = [start, ...stops, end].map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

  if (points.length > MATRIX_MAX_COORDINATES) {
    throw new RouteOptimizationError(
      `This day has ${stops.length} stops; the route optimizer handles up to ${MAX_ROUTE_STOPS}. Split the day or leave some stops off.`
    );
  }
  try {
    return points.length > OPTIMIZED_TRIPS_MAX_COORDINATES
      ? await optimizeViaMatrix(points)
      : await optimizeViaOptimizedTrips(points);
  } catch (error: any) {
    if (error instanceof RouteOptimizationError) throw error;
    console.error("Route optimization error:", error);
    throw new RouteOptimizationError(`Couldn't reach Mapbox: ${error?.message ?? 'unknown error'}`);
  }
}

/** Up to ten stops: Mapbox's Optimized Trips picks the order itself. */
async function optimizeViaOptimizedTrips(points: Point[]): Promise<OptimizedRoute> {
  const response = await fetch(
    `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinatePath(points)}?access_token=${MAPBOX_ACCESS_TOKEN}&roundtrip=false&source=first&destination=last&geometries=geojson&overview=full`
  );

  if (!response.ok) {
    const detail = await mapboxDetail(response);
    console.error(`Route optimization failed: ${response.status} ${response.statusText}`, detail);
    throw new RouteOptimizationError(`Mapbox couldn't optimize this route (${response.status}): ${detail}`);
  }

  const data = await response.json();

  if (data.code !== "Ok") {
    console.error(`Mapbox API error: ${data.code}`, data.message);
    // NoRoute / NoSegment mean a stop's pin isn't on a drivable road.
    throw new RouteOptimizationError(`Mapbox couldn't optimize this route: ${data.message || data.code}`);
  }

  const trip = data.trips?.[0];
  if (!trip) {
    throw new RouteOptimizationError("Mapbox returned no trip for this route.");
  }

  const waypoints = data.waypoints || [];
  const legs = trip.legs || [];

  // data.waypoints is in INPUT order; each carries waypoint_index = its position in
  // the OPTIMIZED drive. Legs are in optimized order (legs[k] = drive position k → k+1,
  // position 0 being the facility). So the leg INTO the stop at drive position p is
  // legs[p] — indexing legs by input order attached every distance to the wrong stop
  // (a Thorp run 100 miles out showed "+10.9 mi").
  const optimizedStops: OptimizedStop[] = waypoints.slice(1, -1).map((wp: any, index: number) => {
    const tripPosition = wp.waypoint_index - 1;
    const leg = legs[tripPosition] || {};
    return {
      stopIndex: index, // which input stop this is
      waypointIndex: tripPosition, // where it lands in the optimized sequence
      distanceFromPrevious: leg.distance || 0,
      durationFromPrevious: leg.duration || 0,
    };
  });

  return {
    stops: optimizedStops,
    totalDuration: trip.duration || 0,
    totalDistance: trip.distance || 0,
    geometry: trip.geometry,
  };
}

/** Eleven to 23 stops: a drive-time matrix from Mapbox, the order chosen here,
 *  then Directions over that order for the line on the map and the real legs. */
async function optimizeViaMatrix(points: Point[]): Promise<OptimizedRoute> {
  const response = await fetch(
    `https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coordinatePath(points)}?annotations=duration,distance&access_token=${MAPBOX_ACCESS_TOKEN}`
  );
  if (!response.ok) {
    const detail = await mapboxDetail(response);
    console.error(`Route matrix failed: ${response.status} ${response.statusText}`, detail);
    throw new RouteOptimizationError(`Mapbox couldn't measure the drives between these stops (${response.status}): ${detail}`);
  }
  const data = await response.json();
  if (data.code !== "Ok" || !Array.isArray(data.durations)) {
    console.error(`Mapbox matrix error: ${data.code}`, data.message);
    throw new RouteOptimizationError(`Mapbox couldn't measure the drives between these stops: ${data.message || data.code}`);
  }
  const durations: (number | null)[][] = data.durations;
  const distances: (number | null)[][] | undefined = Array.isArray(data.distances) ? data.distances : undefined;

  // Point indices of the stops in drive order (never the start or the end).
  const order = shortestOpenTour(durations);
  const last = points.length - 1;
  const ordered = [points[0], ...order.map((i) => points[i]), points[last]];

  // Directions draws the line and gives the legs as driven. If it can't, the
  // matrix's own numbers stand in and the route saves without a line.
  const directions = await getRouteDirections(ordered);
  const legFrom = (from: number, to: number) => ({
    distance: distances?.[from]?.[to] ?? 0,
    duration: durations[from]?.[to] ?? 0,
  });
  const matrixLegs = ordered.slice(1).map((_, k) => {
    const from = k === 0 ? 0 : order[k - 1];
    const to = k < order.length ? order[k] : last;
    return legFrom(from, to);
  });
  const legs = directions?.legs?.length === matrixLegs.length ? directions.legs : matrixLegs;

  // Same shape as the Optimized Trips path: the leg INTO the stop at drive
  // position p is legs[p], position 0 being the start point.
  const optimizedStops: OptimizedStop[] = order
    .map((pointIndex, position) => ({
      stopIndex: pointIndex - 1,
      waypointIndex: position,
      distanceFromPrevious: legs[position]?.distance ?? 0,
      durationFromPrevious: legs[position]?.duration ?? 0,
    }))
    .sort((a, b) => a.stopIndex - b.stopIndex);

  const sum = (key: 'distance' | 'duration') => legs.reduce((total, leg) => total + (leg[key] ?? 0), 0);
  return {
    stops: optimizedStops,
    totalDuration: directions?.duration ?? sum('duration'),
    totalDistance: directions?.distance ?? sum('distance'),
    geometry: directions?.geometry,
  };
}

// A pair Mapbox can't connect by road: far enough to lose every comparison
// while the sums stay finite, so the rest of the day still gets an order.
const UNREACHABLE_SECONDS = 10_000_000;

/** Drive order for the stops of a duration matrix whose first index is the
 *  start and last index the end: every stop once, as little driving as the
 *  search finds. Nearest-neighbour to begin, then 2-opt (reverse a run) and
 *  or-opt (move a run of one to three stops) until neither improves. Costs are
 *  summed along the whole tour, so one-way streets and asymmetric drive times
 *  are respected. 23 stops is tiny for this. */
export function shortestOpenTour(matrix: (number | null)[][]): number[] {
  const n = matrix.length;
  const last = n - 1;
  const cost = (a: number, b: number) => matrix[a]?.[b] ?? UNREACHABLE_SECONDS;
  const stops = Array.from({ length: Math.max(n - 2, 0) }, (_, i) => i + 1);
  if (stops.length <= 1) return stops;

  const tourCost = (tour: number[]) => {
    let total = cost(0, tour[0]);
    for (let i = 1; i < tour.length; i++) total += cost(tour[i - 1], tour[i]);
    return total + cost(tour[tour.length - 1], last);
  };

  const left = new Set(stops);
  let tour: number[] = [];
  let at = 0;
  while (left.size) {
    let next = -1;
    let nextCost = Number.POSITIVE_INFINITY;
    for (const candidate of Array.from(left)) {
      const c = cost(at, candidate);
      if (c < nextCost) { nextCost = c; next = candidate; }
    }
    tour.push(next);
    left.delete(next);
    at = next;
  }

  let best = tourCost(tour);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < tour.length - 1; i++) {
      for (let j = i + 1; j < tour.length; j++) {
        const candidate = [...tour.slice(0, i), ...tour.slice(i, j + 1).reverse(), ...tour.slice(j + 1)];
        const c = tourCost(candidate);
        if (c < best - 1e-9) { tour = candidate; best = c; improved = true; }
      }
    }
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= tour.length; i++) {
        const run = tour.slice(i, i + len);
        const rest = [...tour.slice(0, i), ...tour.slice(i + len)];
        for (let k = 0; k <= rest.length; k++) {
          if (k === i) continue;
          const candidate = [...rest.slice(0, k), ...run, ...rest.slice(k)];
          const c = tourCost(candidate);
          if (c < best - 1e-9) { tour = candidate; best = c; improved = true; }
        }
      }
    }
  }
  return tour;
}

export async function getRouteDirections(
  stops: Array<{ latitude: number; longitude: number }>
): Promise<{ geometry: { type: string; coordinates: number[][] }; duration: number; distance: number; legs: Array<{ distance: number; duration: number }> } | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error("Mapbox access token not configured");
    return null;
  }

  if (stops.length < 2) {
    return null;
  }

  const coordinatesString = stops
    .map((stop) => `${stop.longitude},${stop.latitude}`)
    .join(";");

  try {
    const response = await fetch(
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinatesString}?access_token=${MAPBOX_ACCESS_TOKEN}&geometries=geojson&overview=full`
    );

    if (!response.ok) {
      console.error(`Directions failed: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.code !== "Ok" || !data.routes?.[0]) {
      console.error("No route found");
      return null;
    }

    const route = data.routes[0];
    return {
      geometry: route.geometry,
      duration: route.duration,
      distance: route.distance,
      legs: (route.legs ?? []).map((l: any) => ({ distance: l.distance ?? 0, duration: l.duration ?? 0 })),
    };
  } catch (error) {
    console.error("Directions error:", error);
    return null;
  }
}

/**
 * Static route map with numbered stop pins (and the facility marked), for the
 * Routes screen and the driver packet. Pins only — full route geometry can
 * overflow the Static Images URL limit on long runs.
 */
export function buildStaticRouteMapUrl(
  stops: Array<{ latitude: number; longitude: number; order: number }>,
  token: string,
  size = "1000x560"
): string | null {
  if (!stops.length || !token) return null;
  const facility = getFacilityLocation();
  const pins = [
    `pin-s-warehouse+1f2937(${facility.longitude},${facility.latitude})`,
    ...stops.map((s) => `pin-l-${s.order}+b45309(${s.longitude},${s.latitude})`),
  ].join(",");
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}/auto/${size}@2x?padding=60&access_token=${token}`;
}

/** Fetch the static route map as image bytes for embedding in the packet PDF. */
export async function fetchRouteMapImage(
  stops: Array<{ latitude: number; longitude: number; order: number }>
): Promise<Buffer | null> {
  if (!MAPBOX_ACCESS_TOKEN) return null;
  const url = buildStaticRouteMapUrl(stops, MAPBOX_ACCESS_TOKEN);
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`Static map fetch failed: ${res.status}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e: any) {
    console.error("Static map fetch error:", e.message);
    return null;
  }
}
