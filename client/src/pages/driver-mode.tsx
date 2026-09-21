import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, format } from "date-fns";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSharedDeliveryDate } from "@/components/staff/deliveries-tabs";
import {
  Navigation, Check, ChevronLeft, ChevronRight, Loader2, MapPinned, Undo2, LayoutDashboard, Route as RouteIcon,
} from "lucide-react";

/**
 * Driver mode (owner, 2026-09-22): the delivery day on a phone. The saved
 * route's stops in drive order — or the day's deliveries when no route has
 * been optimized — each with a Navigate button that hands off to Google
 * Maps, what to unload, who to ask for, and a Delivered button. Installs to
 * the home screen from the site's manifest, so it works on Android today and
 * an iPhone the same way; a store-listed app can wrap this same page later.
 */

interface DriverLine { label: string; quantity: number }

interface DriverStop {
  key: string;
  type: "order" | "custom";
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromPrevious: number | null;
  durationFromPrevious: number | null;
  routed: boolean;
  // The address moved (or lost its pin) since the route was built: Navigate
  // goes to the CURRENT address, but the drive order and legs are stale.
  addressChanged: boolean;
  // order stops
  invoiceNumber?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  deliveryInstructions?: string | null;
  // Our own notes for this store, written by staff under Customers → location.
  driverNotes?: string | null;
  orderNotes?: string | null;
  poNumber?: string | null;
  status?: string;
  paid?: boolean;
  total?: number;
  lines?: DriverLine[];
  cases?: number;
  // custom stops
  notes?: string | null;
}

interface DriverDay {
  date: string;
  route: {
    id: string;
    totalDistanceMeters: number | null;
    totalDurationSeconds: number | null;
    start: { label: string };
    end: { label: string };
    generatedAt: string | null;
    generatedBy: string | null;
  } | null;
  stops: DriverStop[];
  summary: { deliveries: number; delivered: number; cases: number };
}

const miles = (m: number) => `${(m / 1609.34).toFixed(1)} mi`;
const minutes = (s: number) => {
  const total = Math.round(s / 60);
  return total >= 60 ? `${Math.floor(total / 60)}h ${total % 60}m` : `${total} min`;
};

/** Where Google Maps should take the driver: the pin when we have one, the
 *  typed address otherwise. */
const destinationOf = (stop: DriverStop): string | null =>
  stop.latitude != null && stop.longitude != null
    ? `${stop.latitude},${stop.longitude}`
    : stop.address
      ? stop.address
      : null;

/** Directions from wherever the phone is. Opens the Google Maps app when it's
 *  installed (Android and iPhone both honor this link), the website otherwise. */
const navigateUrl = (stop: DriverStop): string | null => {
  const destination = destinationOf(stop);
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`
    : null;
};

/** The remaining stops as one trip. A Maps URL opened in a mobile BROWSER
 *  honors only three waypoints plus the destination (the app takes nine), and
 *  the browser is where the link lands when the app isn't installed — so the
 *  day is handed over four stops at a time. */
const TRIP_BATCH = 4;
const remainingTripUrl = (stops: DriverStop[]): { url: string; count: number; total: number } | null => {
  const points = stops.map(destinationOf).filter((d): d is string => !!d);
  if (points.length === 0) return null;
  const batch = points.slice(0, TRIP_BATCH);
  const destination = batch[batch.length - 1];
  const waypoints = batch.slice(0, -1);
  const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` +
    (waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : "") + `&travelmode=driving`;
  return { url, count: batch.length, total: points.length };
};

/** Custom stops have no order to mark; "done" lives on this phone, per day. */
function useLocalDone(dateKey: string) {
  const storageKey = `driver-done:${dateKey}`;
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(storageKey) || "{}")); } catch { setDone({}); }
  }, [storageKey]);
  const toggle = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode etc. */ }
      return next;
    });
  };
  return { done, toggle };
}

export default function DriverMode() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useSharedDeliveryDate();
  // The calendar day as the driver sees it. The UTC date is already tomorrow
  // from 5 p.m. Pacific, which loaded the next day's stops under "Today".
  const dateKey = format(selectedDate, "yyyy-MM-dd");
  const { done: localDone, toggle: toggleLocalDone } = useLocalDone(dateKey);
  const [confirming, setConfirming] = useState<DriverStop | null>(null);

  const { data: day, isLoading, isError, error } = useQuery<DriverDay>({
    queryKey: ["/api/driver/day", dateKey],
    // The office may re-optimize or re-schedule while the van is out.
    refetchInterval: 60_000,
  });

  const setStatus = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: "delivered" | "packaged" }) =>
      apiRequest("PATCH", `/api/wholesale/orders/${orderId}`, { status }),
    onSuccess: (data: any, { status }) => {
      // Every loaded day, not just the one on screen: the driver may have moved
      // to another day while the save was in flight.
      queryClient.invalidateQueries({ queryKey: ["/api/driver/day"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      const warnings: string[] = Array.isArray(data?.stockWarnings) ? data.stockWarnings : [];
      toast({
        title: status === "delivered" ? "Delivered" : "Delivery undone",
        description: warnings.length ? warnings.join(" ") : undefined,
        variant: warnings.length ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Couldn't update the order", description: e.message, variant: "destructive" }),
  });

  const stops = day?.stops ?? [];
  const remaining = useMemo(
    () => stops.filter((s) => (s.type === "order" ? s.status !== "delivered" : !localDone[s.id])),
    [stops, localDone],
  );
  const trip = useMemo(() => remainingTripUrl(remaining), [remaining]);
  const isToday = dateKey === format(new Date(), "yyyy-MM-dd");

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      {/* Top bar: the day, progress, and the way back to the rest of the portal. */}
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="Previous day" data-testid="button-prev-day">
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <div className="text-center min-w-0">
            <div className="font-semibold leading-tight" data-testid="text-driver-date">
              {isToday ? "Today · " : ""}{format(selectedDate, "EEE, MMM d")}
            </div>
            {day && (
              <div className="text-xs text-muted-foreground" data-testid="text-driver-progress">
                {day.summary.delivered} of {day.summary.deliveries} delivered · {day.summary.cases} cases
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="Next day" data-testid="button-next-day">
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <main className="px-3 py-3 space-y-3 max-w-xl mx-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading the day…</div>
        ) : isError ? (
          <p className="p-6 text-destructive">Couldn't load the day: {(error as any)?.message}</p>
        ) : !day ? null : (
          <>
            {/* Route line: what this list is and where it came from. */}
            <div className="rounded-lg border bg-card px-3 py-2 text-sm" data-testid="text-route-status">
              {day.route ? (
                <>
                  <div className="flex items-center gap-2 font-medium"><RouteIcon className="w-4 h-4 text-cedar" /> Optimized route
                    {day.route.totalDistanceMeters != null && day.route.totalDurationSeconds != null && (
                      <span className="text-muted-foreground font-normal">· {miles(day.route.totalDistanceMeters)} · {minutes(day.route.totalDurationSeconds)}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {day.route.start.label} → {day.route.end.label}
                    {day.route.generatedAt ? ` · saved ${format(new Date(day.route.generatedAt), "MMM d, h:mm a")}` : ""}
                    {day.route.generatedBy ? ` by ${day.route.generatedBy}` : ""}
                  </div>
                </>
              ) : stops.length > 0 ? (
                <div className="text-muted-foreground">
                  No route has been optimized for this day, so stops are in no particular order.{" "}
                  <Link href={`/staff-portal/wholesale/delivery-routes?date=${dateKey}`} className="underline">Optimize it on the Routes page</Link>.
                </div>
              ) : (
                <div className="text-muted-foreground" data-testid="text-no-stops">No deliveries scheduled for this day.</div>
              )}
            </div>

            {trip && remaining.length > 1 && (
              <Button asChild variant="outline" className="w-full h-11" data-testid="button-open-trip">
                <a href={trip.url} target="_blank" rel="noopener noreferrer">
                  <MapPinned className="w-4 h-4 mr-2" />
                  {trip.count < trip.total ? `Open next ${trip.count} stops in Google Maps` : `Open all ${trip.count} remaining stops in Google Maps`}
                </a>
              </Button>
            )}

            <ol className="space-y-3">
              {stops.map((stop, index) => {
                const isDone = stop.type === "order" ? stop.status === "delivered" : !!localDone[stop.id];
                const nav = navigateUrl(stop);
                return (
                  <li key={stop.key} className={`rounded-xl border bg-card shadow-sm overflow-hidden ${isDone ? "opacity-70" : ""}`} data-testid={`stop-${stop.key}`}>
                    <div className="p-3 space-y-2">
                      <div className="flex items-start gap-3">
                        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center font-semibold ${isDone ? "bg-green-600 text-white" : "bg-primary text-primary-foreground"}`} aria-label={isDone ? "Done" : `Stop ${index + 1}`}>
                          {isDone ? <Check className="w-5 h-5" /> : index + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold leading-snug" data-testid={`text-stop-name-${stop.key}`}>{stop.name}</div>
                          {stop.address ? (
                            <div className="text-sm text-muted-foreground">{stop.address}</div>
                          ) : (
                            <div className="text-sm text-destructive">No address on file</div>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {stop.distanceFromPrevious != null && stop.durationFromPrevious != null && (
                              <Badge variant="outline" className="font-normal">+{miles(stop.distanceFromPrevious)} · {minutes(stop.durationFromPrevious)}</Badge>
                            )}
                            {!stop.routed && day.route && <Badge variant="secondary" className="font-normal">Added after the route was built</Badge>}
                            {stop.addressChanged && (
                              <Badge variant="outline" className="font-normal whitespace-normal text-left border-amber-400 text-amber-800 dark:text-amber-300" data-testid={`badge-address-changed-${stop.key}`}>
                                Address changed since the route was built — re-optimize
                              </Badge>
                            )}
                            {stop.type === "order" && (
                              <Badge variant={stop.paid ? "secondary" : "outline"} className={stop.paid ? "font-normal" : "font-normal border-amber-400 text-amber-800 dark:text-amber-300"}>
                                {stop.paid ? "Paid" : "Unpaid"}
                              </Badge>
                            )}
                            {stop.poNumber && <Badge variant="outline" className="font-normal">PO {stop.poNumber}</Badge>}
                            {stop.type === "custom" && <Badge variant="secondary" className="font-normal">Stop</Badge>}
                          </div>
                        </div>
                      </div>

                      {stop.type === "order" && stop.lines && stop.lines.length > 0 && (
                        <ul className="text-sm rounded-md bg-muted/60 px-3 py-2 space-y-0.5" data-testid={`list-lines-${stop.key}`}>
                          {stop.lines.map((line, i) => (
                            <li key={i} className="flex justify-between gap-3">
                              <span className="min-w-0">{line.label}</span>
                              <span className="font-semibold tabular-nums">×{line.quantity}</span>
                            </li>
                          ))}
                          <li className="flex justify-between gap-3 border-t pt-1 mt-1 text-muted-foreground">
                            <span>Total</span><span className="font-semibold tabular-nums">{stop.cases} case{stop.cases === 1 ? "" : "s"}</span>
                          </li>
                        </ul>
                      )}

                      {stop.driverNotes && (
                        <p className="text-sm rounded-md border border-cedar/40 bg-cedar/10 px-3 py-2 whitespace-pre-line" data-testid={`text-driver-notes-${stop.key}`}>
                          <span className="font-medium">Our notes:</span> {stop.driverNotes}
                        </p>
                      )}
                      {stop.deliveryInstructions && (
                        <p className="text-sm rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950 dark:border-amber-800 px-3 py-2 whitespace-pre-line" data-testid={`text-instructions-${stop.key}`}>
                          <span className="font-medium">Customer's instructions:</span> {stop.deliveryInstructions}
                        </p>
                      )}
                      {stop.orderNotes && (
                        <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">Order note:</span> {stop.orderNotes}</p>
                      )}
                      {stop.notes && (
                        <p className="text-sm text-muted-foreground">{stop.notes}</p>
                      )}
                      {stop.contactName && (
                        <p className="text-sm text-muted-foreground">Ask for <span className="text-foreground">{stop.contactName}</span></p>
                      )}

                      {/* Navigate and Delivered only — no Call button (owner, 2026-09-22). */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        {nav ? (
                          <Button asChild className="h-12" data-testid={`button-navigate-${stop.key}`}>
                            <a href={nav} target="_blank" rel="noopener noreferrer"><Navigation className="w-4 h-4 mr-1.5" /> Navigate</a>
                          </Button>
                        ) : (
                          <Button className="h-12" disabled>Navigate</Button>
                        )}
                        {stop.type === "order" ? (
                          isDone ? (
                            <Button variant="outline" className="h-12" disabled={setStatus.isPending}
                              onClick={() => setStatus.mutate({ orderId: stop.id, status: "packaged" })} data-testid={`button-undo-${stop.key}`}>
                              <Undo2 className="w-4 h-4 mr-1.5" /> Undo
                            </Button>
                          ) : (
                            <Button className="h-12 bg-green-700 hover:bg-green-800 text-white" disabled={setStatus.isPending}
                              onClick={() => setConfirming(stop)} data-testid={`button-delivered-${stop.key}`}>
                              <Check className="w-4 h-4 mr-1.5" /> Delivered
                            </Button>
                          )
                        ) : (
                          <Button variant={isDone ? "outline" : "secondary"} className="h-12" onClick={() => toggleLocalDone(stop.id)} data-testid={`button-done-${stop.key}`}>
                            <Check className="w-4 h-4 mr-1.5" /> {isDone ? "Undo" : "Done"}
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </main>

      {/* Bottom bar: back to the portal, and the install hint the first time. */}
      <nav className="fixed bottom-0 inset-x-0 z-20 border-t bg-card/95 backdrop-blur px-3 py-2 flex items-center justify-between gap-2 text-sm">
        <Link href="/staff-portal/orders-board" className="inline-flex items-center gap-1.5 text-muted-foreground" data-testid="link-staff-portal">
          <LayoutDashboard className="w-4 h-4" /> Staff portal
        </Link>
        <span className="text-xs text-muted-foreground text-right">
          Add to home screen for a full-screen app
        </span>
      </nav>

      <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark delivered?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirming?.name}{confirming?.cases ? ` — ${confirming.cases} case${confirming.cases === 1 ? "" : "s"}` : ""}.
              The order is marked delivered and its stock comes off the shelf. Undo is one tap away if this was a slip.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" data-testid="button-cancel-delivered">Not yet</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-green-700 hover:bg-green-800"
              onClick={() => { if (confirming) setStatus.mutate({ orderId: confirming.id, status: "delivered" }); setConfirming(null); }}
              data-testid="button-confirm-delivered"
            >
              Delivered
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
