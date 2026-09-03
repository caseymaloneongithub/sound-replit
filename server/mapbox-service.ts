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

  const fullAddress = `${address}, ${city}, ${state} ${zipCode}`;
  const encodedAddress = encodeURIComponent(fullAddress);
  
  try {
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodedAddress}.json?access_token=${MAPBOX_ACCESS_TOKEN}&country=US&limit=1`
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

export async function optimizeDeliveryRoute(
  stops: Array<{
    id: string;
    latitude: number;
    longitude: number;
    name: string;
    address: string;
    type: "order" | "custom";
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
  const allCoordinates = [
    `${start.longitude},${start.latitude}`,
    ...stops.map((stop) => `${stop.longitude},${stop.latitude}`),
    `${end.longitude},${end.latitude}`,
  ];

  const coordinatesString = allCoordinates.join(";");

  try {
    const response = await fetch(
      `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinatesString}?access_token=${MAPBOX_ACCESS_TOKEN}&roundtrip=false&source=first&destination=last&geometries=geojson&overview=full`
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Route optimization failed: ${response.status} ${response.statusText}`, errorText);
      return null;
    }

    const data = await response.json();

    if (data.code !== "Ok") {
      console.error(`Mapbox API error: ${data.code}`, data.message);
      return null;
    }

    const trip = data.trips?.[0];
    if (!trip) {
      console.error("No optimized trip returned");
      return null;
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
  } catch (error) {
    console.error("Route optimization error:", error);
    return null;
  }
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
