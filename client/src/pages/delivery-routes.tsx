import { useState } from "react";
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
import { CalendarIcon, MapPin, Route, Clock, Plus, Navigation, Truck, Building2, X, RefreshCw } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";

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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedCustomStops, setSelectedCustomStops] = useState<string[]>([]);
  const [isAddStopOpen, setIsAddStopOpen] = useState(false);
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRouteResponse | null>(null);
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
        { customStopIds: selectedCustomStops }
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
                  <Building2 className="h-5 w-5" />
                  Facility Start/End Point
                </CardTitle>
              </CardHeader>
              <CardContent>
                {facility && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="h-4 w-4 text-primary" />
                    <span>
                      {facility.address}, {facility.city}, {facility.state}{" "}
                      {facility.zipCode}
                    </span>
                    <Badge variant="outline">Origin/Destination</Badge>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Truck className="h-5 w-5" />
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
                          <MapPin
                            className={`h-5 w-5 ${
                              order.location?.latitude ? "text-green-500" : "text-muted-foreground"
                            }`}
                          />
                          <div>
                            <p className="font-medium">
                              {order.customer?.businessName || "Unknown"}
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
                    <Navigation className="h-5 w-5" />
                    Optimized Route
                  </CardTitle>
                  <CardDescription>
                    Total: {formatDistance(optimizedRoute.totalDistance)} -{" "}
                    {formatDuration(optimizedRoute.totalDuration)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-primary/5 rounded-md">
                      <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-bold">
                        S
                      </div>
                      <div>
                        <p className="font-medium">Start: Ballard Facility</p>
                        <p className="text-sm text-muted-foreground">
                          {facility?.address}
                        </p>
                      </div>
                    </div>

                    {optimizedRoute.stops.map((stop, index) => (
                      <div
                        key={stop.id}
                        className="flex items-center gap-3 p-3 border rounded-md"
                        data-testid={`optimized-stop-${index}`}
                      >
                        <div className="w-8 h-8 rounded-full bg-muted text-foreground flex items-center justify-center text-sm font-bold">
                          {index + 1}
                        </div>
                        <div className="flex-1">
                          <p className="font-medium">{stop.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {stop.address}
                          </p>
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
                        <p className="font-medium">End: Ballard Facility</p>
                        <p className="text-sm text-muted-foreground">
                          {facility?.address}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <MapPin className="h-5 w-5" />
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
                          <FormField
                            control={form.control}
                            name="address"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Address</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="1234 Main St"
                                    {...field}
                                    data-testid="input-stop-address"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <div className="grid grid-cols-3 gap-3">
                            <FormField
                              control={form.control}
                              name="city"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>City</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="Seattle"
                                      {...field}
                                      data-testid="input-stop-city"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="state"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>State</FormLabel>
                                  <FormControl>
                                    <Input {...field} data-testid="input-stop-state" />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                            <FormField
                              control={form.control}
                              name="zipCode"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>Zip</FormLabel>
                                  <FormControl>
                                    <Input
                                      placeholder="98107"
                                      {...field}
                                      data-testid="input-stop-zip"
                                    />
                                  </FormControl>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
                          </div>
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
                  <Clock className="h-5 w-5" />
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
