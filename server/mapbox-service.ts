const MAPBOX_ACCESS_TOKEN = process.env.MAPBOX_ACCESS_TOKEN;

interface GeocodingResult {
  latitude: number;
  longitude: number;
  placeName: string;
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

    const [longitude, latitude] = data.features[0].center;
    
    return {
      latitude,
      longitude,
      placeName: data.features[0].place_name,
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
  }>
): Promise<OptimizedRoute | null> {
  if (!MAPBOX_ACCESS_TOKEN) {
    console.error("Mapbox access token not configured");
    return null;
  }

  if (stops.length === 0) {
    return { stops: [], totalDuration: 0, totalDistance: 0 };
  }

  const facility = getFacilityLocation();
  const allCoordinates = [
    `${facility.longitude},${facility.latitude}`,
    ...stops.map((stop) => `${stop.longitude},${stop.latitude}`),
    `${facility.longitude},${facility.latitude}`,
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
    
    const optimizedStops: OptimizedStop[] = waypoints.slice(1, -1).map((wp: any, index: number) => {
      const leg = legs[index] || {};
      return {
        stopIndex: index,
        waypointIndex: wp.waypoint_index - 1,
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
): Promise<{ geometry: { type: string; coordinates: number[][] }; duration: number; distance: number } | null> {
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
    };
  } catch (error) {
    console.error("Directions error:", error);
    return null;
  }
}
