import { useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CalendarIcon, Route, Plus, X, RefreshCw, ArrowLeftRight, Loader2, GripVertical } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { DeliveriesTabs, useSharedDeliveryDate } from "@/components/staff/deliveries-tabs";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AddressAutofillFields } from "@/components/address-autofill";

interface DeliveryStop {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  notes?: string;
  latitude?: string;
  longitude?: string;
  geocodedAt?: string;
}

interface EnrichedOrder {
  id: string;
  customerId: string;
  deliveryDate: string;
  status: string;
  totalAmount: string;
  customer?: {
    businessName: string;
  };
  location?: {
    locationName?: string;
    address: string;
    city: string;
    latitude?: string;
    longitude?: string;
  };
}

interface OptimizedStop {
  id: string;
  latitude: number;
  longitude: number;
  name: string;
  address: string;
  type: "order" | "custom";
  stopOrder: number;
  distanceFromPrevious?: number;
  durationFromPrevious?: number;
}

interface OptimizedRouteResponse {
  success: boolean;
  route?: {
    id: string;
    routeDate: string;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
  };
  stops: OptimizedStop[];
  totalDuration: number;
  totalDistance: number;
  geometry?: {
    type: string;
    coordinates: number[][];
  };
  // Route endpoints — the brewery unless a custom address was set.
  start?: { label: string; latitude: number; longitude: number };
  end?: { label: string; latitude: number; longitude: number };
  message?: string;
}

const deliveryStopSchema = z.object({
  name: z.string().min(1, "Name is required"),
  address: z.string().min(1, "Address is required"),
  city: z.string().min(1, "City is required"),
  state: z.string().default("WA"),
  zipCode: z.string().min(5, "Zip code is required"),
  notes: z.string().optional(),
});

type DeliveryStopFormData = z.infer<typeof deliveryStopSchema>;

// Preset end point: some route days finish at the airport instead of the brewery.
// Free text like everything else — the server geocodes it on Optimize.
const SEATAC_ADDRESS = "Seattle-Tacoma International Airport";

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes} min`;
}

function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return `${miles.toFixed(1)} mi`;
}

export default function DeliveryRoutes() {
  const [selectedDate, setSelectedDate] = useSharedDeliveryDate();
  const [selectedCustomStops, setSelectedCustomStops] = useState<string[]>([]);
  const [isAddStopOpen, setIsAddStopOpen] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRouteResponse | null>(null);
  // Blank = brewery; anything typed here is geocoded server-side on Optimize.
  const [startAddress, setStartAddress] = useState("");
  const [endAddress, setEndAddress] = useState("");

  // Static map with numbered pins matching the stop list. Uses the public (pk.)
  // browser token; the packet PDF builds the same map server-side.
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
  const routeMapUrl = (() => {
    if (!mapboxToken || !optimizedRoute?.stops?.length) return null;
    const startPin = optimizedRoute.start
      ? `pin-s-embassy+1f2937(${optimizedRoute.start.longitude},${optimizedRoute.start.latitude})`
      : `pin-s-warehouse+1f2937(-122.3894,47.6694)`;
    const endPin = optimizedRoute.end
      ? `pin-s-embassy+1f2937(${optimizedRoute.end.longitude},${optimizedRoute.end.latitude})`
      : null;
    const pins = [
      startPin,
      ...optimizedRoute.stops.map((s, i) => `pin-l-${i + 1}+b45309(${s.longitude},${s.latitude})`),
      ...(endPin && endPin !== startPin ? [endPin] : []),
    ].join(",");
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}/auto/1000x560@2x?padding=60&access_token=${mapboxToken}`;
  })();
  const { toast } = useToast();

  const form = useForm<DeliveryStopFormData>({
    resolver: zodResolver(deliveryStopSchema),
    defaultValues: {
      name: "",
      address: "",
      city: "",
      state: "WA",
      zipCode: "",
      notes: "",
    },
  });

  const { data: deliveryOrders = [], isLoading: ordersLoading } = useQuery<EnrichedOrder[]>({
    queryKey: ["/api/delivery/orders", selectedDate.toISOString().split("T")[0]],
    queryFn: async () => {
      const response = await fetch(
        `/api/delivery/orders/${selectedDate.toISOString().split("T")[0]}`
      );
      if (!response.ok) throw new Error("Failed to fetch delivery orders");
      return response.json();
    },
    // The app default is staleTime: Infinity — an order entered after this page loaded
    // never appeared until a full reload. Keep the day's list live.
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  // Day's demand vs finished-goods stock — surfaces shortages BEFORE the route is built.
  const { data: stockCheck } = useQuery<{ rows: Array<{ label: string; needed: number; inStock: number | null; short: boolean }>; shortages: number }>({
    queryKey: ["/api/delivery/stock-check", selectedDate.toISOString().split("T")[0]],
    queryFn: async () => {
      const response = await fetch(`/api/delivery/stock-check/${selectedDate.toISOString().split("T")[0]}`);
      if (!response.ok) throw new Error("Failed to check stock");
      return response.json();
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  const { data: customStops = [], isLoading: stopsLoading } = useQuery<DeliveryStop[]>({
    queryKey: ["/api/delivery/stops"],
  });

  const { data: facility } = useQuery<{
    address: string;
    city: string;
    state: string;
    zipCode: string;
    latitude: number;
    longitude: number;
  }>({
    queryKey: ["/api/delivery/facility"],
  });

  const createStopMutation = useMutation({
    mutationFn: async (data: DeliveryStopFormData) => {
      return apiRequest("POST", "/api/delivery/stops", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/delivery/stops"] });
      setIsAddStopOpen(false);
      form.reset();
      toast({ title: "Stop added successfully" });
    },
    onError: (error: Error) => {
      toast({
        title: "Error adding stop",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteStopMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/delivery/stops/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/delivery/stops"] });
      toast({ title: "Stop deleted" });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't delete stop", description: e.message, variant: "destructive" });
    },
  });

  const geocodeAllMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/delivery/geocode-all");
    },
    onSuccess: (data: { geocoded: number; failed: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/delivery/orders"] });
      toast({
        title: "Geocoding complete",
        description: `Geocoded ${data.geocoded} locations, ${data.failed} failed`,
      });
    },
  });

  const optimizeRouteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest(
        "POST",
        `/api/delivery/optimize/${selectedDate.toISOString().split("T")[0]}`,
        { customStopIds: selectedCustomStops, startAddress, endAddress }
      );
      return response as OptimizedRouteResponse;
    },
    onSuccess: (data) => {
      setOptimizedRoute(data);
      if (data.stops.length === 0) {
        toast({
          title: "No stops to optimize",
          description: "No geocoded delivery locations found for this date",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Route optimized!",
          description: `Total distance: ${formatDistance(data.totalDistance)}, Duration: ${formatDuration(data.totalDuration)}`,
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Optimization failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const reverseMutation = useMutation({
    mutationFn: async (routeId: string) =>
      (await apiRequest("POST", `/api/delivery/routes/${routeId}/reverse`, {})) as OptimizedRouteResponse,
    onSuccess: (data) => {
      setOptimizedRoute(data);
      toast({
        title: "Route reversed",
        description: `Now ${formatDistance(data.totalDistance)}, ${formatDuration(data.totalDuration)} the other way around`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't reverse", description: error.message, variant: "destructive" });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async ({ routeId, order }: { routeId: string; order: string[] }) =>
      (await apiRequest("POST", `/api/delivery/routes/${routeId}/reorder`, { order })) as OptimizedRouteResponse,
    onSuccess: (data) => {
      setOptimizedRoute(data);
      toast({
        title: "Route reordered",
        description: `Now ${formatDistance(data.totalDistance)}, ${formatDuration(data.totalDuration)}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't reorder", description: error.message, variant: "destructive" });
    },
  });

  // Drag a stop card onto another to move it there; drive times recompute server-side.
  const dragIndexRef = useRef<number | null>(null);
  const dropOnIndex = (target: number) => {
    const from = dragIndexRef.current;
    dragIndexRef.current = null;
    if (from === null || from === target || !optimizedRoute?.route?.id) return;
    const ids = optimizedRoute.stops.map((s) => String(s.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(target, 0, moved);
    reorderMutation.mutate({ routeId: optimizedRoute.route.id, order: ids });
  };

  // Per-stop ETAs: leave time + minutes-per-stop dwell, applied cumulatively down
  // the route. The global value is the default; any stop can override its own.
  const [departTime, setDepartTime] = useState("08:00");
  const [stopMinutes, setStopMinutes] = useState(10);
  const [dwellOverrides, setDwellOverrides] = useState<Record<string, number>>({});
  const dwellFor = (stopId: string) => dwellOverrides[stopId] ?? stopMinutes;
  const etaFor = (index: number): string | null => {
    if (!optimizedRoute) return null;
    const [h, m] = departTime.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    let seconds = h * 3600 + m * 60;
    for (let i = 0; i <= index; i++) {
      seconds += optimizedRoute.stops[i]?.durationFromPrevious ?? 0;
      if (i < index) seconds += dwellFor(String(optimizedRoute.stops[i].id)) * 60;
    }
    const d = new Date();
    d.setHours(0, Math.round(seconds / 60), 0, 0);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  };

  const ordersWithGeocode = deliveryOrders.filter(
    (o) => o.location?.latitude && o.location?.longitude
  );
  const ordersWithoutGeocode = deliveryOrders.filter(
    (o) => !o.location?.latitude || !o.location?.longitude
  );

  const onSubmitStop = (data: DeliveryStopFormData) => {
    createStopMutation.mutate(data);
  };

  const toggleCustomStop = (stopId: string) => {
    setSelectedCustomStops((prev) =>
      prev.includes(stopId)
        ? prev.filter((id) => id !== stopId)
        : [...prev, stopId]
    );
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <DeliveriesTabs />
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1
              className="text-4xl font-bold mb-2"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Delivery Route Optimization
            </h1>
            <p className="text-muted-foreground">
              Optimize delivery routes to minimize drive time
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start text-left font-normal"
                  data-testid="button-select-delivery-date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, "PPP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Button
              onClick={() => optimizeRouteMutation.mutate()}
              disabled={optimizeRouteMutation.isPending || ordersWithGeocode.length === 0}
              data-testid="button-optimize-route"
            >
              <Route className="mr-2 h-4 w-4" />
              {optimizeRouteMutation.isPending ? "Optimizing..." : "Optimize Route"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Route Start/End Points
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-sm font-medium mb-1">Start</p>
                    <Input
                      value={startAddress}
                      onChange={(e) => setStartAddress(e.target.value)}
                      placeholder="Ballard Facility (default)"
                      data-testid="input-route-start"
                    />
                  </div>
                  <div>
                    <p className="text-sm font-medium mb-1">End</p>
                    <Input
                      value={endAddress}
                      onChange={(e) => setEndAddress(e.target.value)}
                      placeholder="Ballard Facility (default)"
                      data-testid="input-route-end"
                    />
                    <div className="flex gap-2 mt-2">
                      <Button
                        type="button"
                        variant={endAddress === "" ? "secondary" : "outline"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setEndAddress("")}
                        data-testid="button-end-brewery"
                      >
                        Brewery
                      </Button>
                      <Button
                        type="button"
                        variant={endAddress === SEATAC_ADDRESS ? "secondary" : "outline"}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => setEndAddress(SEATAC_ADDRESS)}
                        data-testid="button-end-seatac"
                      >
                        Sea-Tac Airport
                      </Button>
                    </div>
                  </div>
                </div>
                {facility && (
                  <p className="text-sm text-muted-foreground">
                    Leave blank to use the brewery: {facility.address}, {facility.city}, {facility.state}{" "}
                    {facility.zipCode}. Applies the next time you hit Optimize Route.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      Deliveries for {format(selectedDate, "MMMM d, yyyy")}
                    </CardTitle>
                    <CardDescription>
                      {deliveryOrders.length} deliveries scheduled
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => geocodeAllMutation.mutate()}
                    disabled={geocodeAllMutation.isPending}
                    data-testid="button-geocode-all"
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${geocodeAllMutation.isPending ? "animate-spin" : ""}`} />
                    Geocode All
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {ordersLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading deliveries...
                  </div>
                ) : deliveryOrders.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No deliveries scheduled for this date
                  </div>
                ) : (
                  <div className="space-y-4">
                    {ordersWithoutGeocode.length > 0 && (
                      <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-md p-3 mb-4">
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                          {ordersWithoutGeocode.length} location(s) need geocoding before route optimization.
                          Click "Geocode All" to process them.
                        </p>
                      </div>
                    )}
                    {deliveryOrders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between p-3 border rounded-md"
                        data-testid={`delivery-order-${order.id}`}
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <p className="font-medium">
                              {order.customer?.businessName || "Unknown"}
                              {order.location?.locationName && order.location.locationName !== "Main Location" && (
                                <span className="font-normal text-muted-foreground"> — {order.location.locationName}</span>
                              )}
                            </p>
                            {order.location && (
                              <p className="text-sm text-muted-foreground">
                                {order.location.address}, {order.location.city}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={order.location?.latitude ? "default" : "secondary"}
                          >
                            {order.location?.latitude ? "Geocoded" : "Needs Geocoding"}
                          </Badge>
                          <Badge variant="outline">${Number(order.totalAmount).toFixed(2)}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {optimizedRoute && optimizedRoute.stops.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Optimized Route
                  </CardTitle>
                  <CardDescription>
                    Total: {formatDistance(optimizedRoute.totalDistance)} -{" "}
                    {formatDuration(optimizedRoute.totalDuration)}
                    {optimizedRoute.route?.id && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-3"
                          onClick={() => window.open(`/api/delivery/routes/${optimizedRoute.route!.id}/packet`, "_blank")}
                          data-testid="button-print-packet"
                        >
                          Print delivery packet
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="ml-2"
                          disabled={reverseMutation.isPending}
                          onClick={() => reverseMutation.mutate(optimizedRoute.route!.id)}
                          data-testid="button-reverse-route"
                        >
                          {reverseMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ArrowLeftRight className="w-4 h-4 mr-1" />}
                          Reverse route
                        </Button>
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {/* ETA controls: leave time + minutes per stop feed the per-stop ETAs */}
                  <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
                    <label className="flex items-center gap-2">
                      <span className="text-muted-foreground">Leave at</span>
                      <Input type="time" value={departTime} onChange={(e) => setDepartTime(e.target.value)}
                        className="w-28 h-8" data-testid="input-depart-time" />
                    </label>
                    <label className="flex items-center gap-2">
                      <span className="text-muted-foreground">Time per stop</span>
                      <Input type="number" min={0} max={120} value={stopMinutes}
                        onChange={(e) => setStopMinutes(Math.max(0, Number(e.target.value) || 0))}
                        className="w-20 h-8" data-testid="input-stop-minutes" />
                      <span className="text-muted-foreground">min</span>
                    </label>
                    <span className="text-muted-foreground">
                      {optimizedRoute.end && optimizedRoute.end.label !== "Ballard Facility" ? "At end point" : "Back at facility"} ~{(() => {
                        const dwellTotal = optimizedRoute.stops.reduce((s, st) => s + dwellFor(String(st.id)) * 60, 0);
                        const total = optimizedRoute.totalDuration + dwellTotal;
                        const [h, m] = departTime.split(":").map(Number);
                        const d = new Date(); d.setHours(0, Math.round((h * 3600 + m * 60 + total) / 60), 0, 0);
                        return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                      })()}
                    </span>
                    <span className="text-xs text-muted-foreground">Drag stops to reorder — times recalculate.</span>
                  </div>
                  {routeMapUrl && (
                    <img
                      src={routeMapUrl}
                      alt="Route map with numbered stops"
                      className="w-full rounded-md border mb-4"
                      loading="lazy"
                      data-testid="img-route-map"
                    />
                  )}
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                        S
                      </div>
                      <div>
                        <p className="font-medium">Start: {optimizedRoute.start?.label ?? "Ballard Facility"}</p>
                        {(!optimizedRoute.start || optimizedRoute.start.label === "Ballard Facility") && (
                          <p className="text-sm text-muted-foreground">
                            {facility?.address}
                          </p>
                        )}
                      </div>
                    </div>

                    {optimizedRoute.stops.map((stop, index) => (
                      <div
                        key={stop.id}
                        className={`flex items-center gap-3 p-3 border rounded-md cursor-grab active:cursor-grabbing ${reorderMutation.isPending ? "opacity-60" : ""}`}
                        draggable
                        onDragStart={() => { dragIndexRef.current = index; }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => { e.preventDefault(); dropOnIndex(index); }}
                        data-testid={`optimized-stop-${index}`}
                      >
                        <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
                        <div className="w-8 h-8 rounded-full bg-muted text-foreground flex items-center justify-center text-sm font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{stop.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {stop.address}
                          </p>
                          {etaFor(index) && (
                            <p className="text-sm font-medium text-foreground/80 flex items-center gap-1.5" data-testid={`eta-${index}`}>
                              ETA {etaFor(index)} ·
                              <Input
                                type="number"
                                min={0}
                                max={120}
                                value={dwellFor(String(stop.id))}
                                onChange={(e) => setDwellOverrides((prev) => ({ ...prev, [String(stop.id)]: Math.max(0, Number(e.target.value) || 0) }))}
                                onClick={(e) => e.stopPropagation()}
                                draggable={false}
                                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                className="h-6 w-14 px-1 text-sm text-center inline-block"
                                data-testid={`input-dwell-${index}`}
                              />
                              min stop
                            </p>
                          )}
                        </div>
                        <div className="text-right text-sm">
                          {stop.distanceFromPrevious && (
                            <p className="text-muted-foreground">
                              +{formatDistance(stop.distanceFromPrevious)}
                            </p>
                          )}
                          {stop.durationFromPrevious && (
                            <p className="text-muted-foreground">
                              +{formatDuration(stop.durationFromPrevious)}
                            </p>
                          )}
                        </div>
                        <Badge variant={stop.type === "order" ? "default" : "outline"}>
                          {stop.type === "order" ? "Delivery" : "Custom"}
                        </Badge>
                      </div>
                    ))}

                    <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                        E
                      </div>
                      <div>
                        <p className="font-medium">End: {optimizedRoute.end?.label ?? "Ballard Facility"}</p>
                        {(!optimizedRoute.end || optimizedRoute.end.label === "Ballard Facility") && (
                          <p className="text-sm text-muted-foreground">
                            {facility?.address}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            {stockCheck && stockCheck.rows.length > 0 && (
              <Card className={stockCheck.shortages > 0 ? "border-red-300 dark:border-red-800" : ""} data-testid="card-stock-check">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    Stock Check
                    {stockCheck.shortages > 0 ? (
                      <Badge variant="destructive">{stockCheck.shortages} short</Badge>
                    ) : (
                      <Badge className="bg-green-600 hover:bg-green-600">Covered</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {stockCheck.shortages > 0
                      ? "The shelf can't cover this day yet — pack or brew before the run."
                      : "Everything on this day's orders is on the shelf."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5">
                    {stockCheck.rows.map((r) => (
                      <div key={r.label} className="flex items-center justify-between text-sm" data-testid={`stock-row-${r.label}`}>
                        <span className={r.short ? "text-red-700 dark:text-red-400 font-medium" : ""}>{r.label}</span>
                        <span className={r.short ? "text-red-700 dark:text-red-400 font-medium tabular-nums" : "text-muted-foreground tabular-nums"}>
                          {r.needed} needed · {r.inStock == null ? "not tracked" : `${r.inStock} on hand`}
                          {r.short && ` · short ${r.needed - (r.inStock ?? 0)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    Custom Stops
                  </CardTitle>
                  <Dialog open={isAddStopOpen} onOpenChange={setIsAddStopOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" data-testid="button-add-custom-stop">
                        <Plus className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Custom Stop</DialogTitle>
                        <DialogDescription>
                          Add a non-order delivery location (e.g., bank, supplier)
                        </DialogDescription>
                      </DialogHeader>
                      <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmitStop)} className="space-y-4">
                          <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="e.g., US Bank Ballard"
                                    {...field}
                                    data-testid="input-stop-name"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <AddressAutofillFields
                            addressValue={form.watch("address")}
                            cityValue={form.watch("city")}
                            stateValue={form.watch("state")}
                            zipCodeValue={form.watch("zipCode")}
                            onAddressChange={(val) => form.setValue("address", val, { shouldDirty: true, shouldValidate: true })}
                            onCityChange={(val) => form.setValue("city", val, { shouldDirty: true, shouldValidate: true })}
                            onStateChange={(val) => form.setValue("state", val, { shouldDirty: true, shouldValidate: true })}
                            onZipCodeChange={(val) => form.setValue("zipCode", val, { shouldDirty: true, shouldValidate: true })}
                            addressPlaceholder="Start typing an address..."
                            cityPlaceholder="Seattle"
                            statePlaceholder="WA"
                            zipPlaceholder="98107"
                            addressTestId="input-stop-address"
                            cityTestId="input-stop-city"
                            stateTestId="input-stop-state"
                            zipTestId="input-stop-zip"
                            addressError={form.formState.errors.address?.message}
                            cityError={form.formState.errors.city?.message}
                            stateError={form.formState.errors.state?.message}
                            zipError={form.formState.errors.zipCode?.message}
                          />
                          <FormField
                            control={form.control}
                            name="notes"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Notes (optional)</FormLabel>
                                <FormControl>
                                  <Textarea
                                    placeholder="Any special instructions..."
                                    {...field}
                                    data-testid="input-stop-notes"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <DialogFooter>
                            <Button
                              type="submit"
                              disabled={createStopMutation.isPending}
                              data-testid="button-save-stop"
                            >
                              {createStopMutation.isPending ? "Adding..." : "Add Stop"}
                            </Button>
                          </DialogFooter>
                        </form>
                      </Form>
                    </DialogContent>
                  </Dialog>
                </div>
                <CardDescription>
                  Include non-order stops in route optimization
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stopsLoading ? (
                  <div className="text-center py-4 text-muted-foreground">
                    Loading...
                  </div>
                ) : customStops.length === 0 ? (
                  <div className="text-center py-4 text-muted-foreground text-sm">
                    No custom stops added yet
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customStops.map((stop) => (
                      <div
                        key={stop.id}
                        className="flex items-start gap-2 p-2 border rounded-md"
                        data-testid={`custom-stop-${stop.id}`}
                      >
                        <Checkbox
                          id={stop.id}
                          checked={selectedCustomStops.includes(stop.id)}
                          onCheckedChange={() => toggleCustomStop(stop.id)}
                          data-testid={`checkbox-stop-${stop.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <label
                            htmlFor={stop.id}
                            className="font-medium text-sm cursor-pointer"
                          >
                            {stop.name}
                          </label>
                          <p className="text-xs text-muted-foreground truncate">
                            {stop.address}, {stop.city}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteStopMutation.mutate(stop.id)}
                          data-testid={`button-delete-stop-${stop.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  Summary
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Delivery Orders:</span>
                    <span className="font-medium">{deliveryOrders.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Ready for Routing:</span>
                    <span className="font-medium">{ordersWithGeocode.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Custom Stops Selected:</span>
                    <span className="font-medium">{selectedCustomStops.length}</span>
                  </div>
                  {optimizedRoute && optimizedRoute.stops.length > 0 && (
                    <>
                      <hr className="my-2" />
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total Distance:</span>
                        <span className="font-medium">
                          {formatDistance(optimizedRoute.totalDistance)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Est. Duration:</span>
                        <span className="font-medium">
                          {formatDuration(optimizedRoute.totalDuration)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </StaffLayout>
  );
}
