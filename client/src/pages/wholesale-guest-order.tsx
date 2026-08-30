import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Guest wholesale ordering (owner decision 2026-08-27): no sign-in, no email
 * verification. Store and location arrive from the entry page; the order carries an
 * FYI email that only receives the confirmation — invoices go to the billing contacts
 * on file, and staff filter incoming orders as they arrive. Bot guards: a honeypot
 * field and per-IP rate limits on the server. Prices shown are list prices; any
 * store-specific pricing is applied server-side when the order is written.
 */

type Loc = { id: string; locationName: string; street: string; city: string };
type UnitType = { id: string; name: string; description?: string; defaultPrice: string; flavors: Array<{ id: string; name: string }> };
type Line = { unitTypeId: string; flavorId: string; quantity: number };

export default function WholesaleGuestOrder() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const customerId = params.get("customer") ?? "";
  const initialLocationId = params.get("location") ?? "";

  const [lines, setLines] = useState<Line[]>([{ unitTypeId: "", flavorId: "", quantity: 1 }]);
  // Delivery is ALWAYS the default (owner decision 2026-08-31): pickup must be a
  // deliberate choice, never something a customer slides into by not noticing.
  // With no location picked yet, submit stays disabled until they choose one.
  const [fulfillment, setFulfillment] = useState<"delivery" | "pickup">("delivery");
  const [locationId, setLocationId] = useState(initialLocationId);
  const [contactEmail, setContactEmail] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — humans never see it
  const [placed, setPlaced] = useState<{ invoiceNumber: string } | null>(null);

  const { data: storeInfo } = useQuery<{ businessName: string; locations: Loc[] }>({
    queryKey: ["/api/wholesale/claim/locations", customerId],
    queryFn: async () => {
      const res = await fetch(`/api/wholesale/claim/locations?customerId=${customerId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Store not found");
      return res.json();
    },
    enabled: !!customerId,
  });

  // Single-location customers never pick a location — it's chosen for them and the
  // address is shown for comfort. The picker only exists for the Evergreens of the world.
  const soleLocation = storeInfo?.locations.length === 1 ? storeInfo.locations[0] : null;
  useEffect(() => {
    if (soleLocation && !locationId) setLocationId(soleLocation.id);
  }, [soleLocation, locationId]);

  const { data: unitTypes = [] } = useQuery<UnitType[]>({ queryKey: ["/api/wholesale/guest/unit-types"] });
  const { data: minOrder } = useQuery<{ value: number }>({ queryKey: ["/api/settings/wholesale-minimum-order"] });

  const byId = useMemo(() => new Map(unitTypes.map((u) => [u.id, u])), [unitTypes]);
  const total = lines.reduce((sum, l) => {
    const u = byId.get(l.unitTypeId);
    return u ? sum + Number(u.defaultPrice) * l.quantity : sum;
  }, 0);
  const min = Number(minOrder?.value ?? 0);
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim());
  const linesOk = lines.some((l) => l.unitTypeId && l.flavorId);
  const locationOk = fulfillment === "pickup" || !!locationId;

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const submit = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/wholesale/guest-order", {
        customerId,
        items: lines.filter((l) => l.unitTypeId && l.flavorId).map((l) => ({ unitTypeId: l.unitTypeId, flavorId: l.flavorId, quantity: l.quantity })),
        fulfillmentMethod: fulfillment,
        locationId: fulfillment === "delivery" ? locationId : undefined,
        contactEmail: contactEmail.trim(),
        poNumber: poNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        website, // honeypot
      }),
    onSuccess: (res: any) => setPlaced({ invoiceNumber: res.invoiceNumber }),
    onError: (e: any) => toast({ title: "Couldn't place the order", description: e.message || "Try again.", variant: "destructive" }),
  });

  if (!customerId) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <CardTitle>Order online</CardTitle>
            <CardDescription>Start by picking your store.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild data-testid="button-pick-store"><Link href="/wholesale/login">Pick your store</Link></Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  if (placed) {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold tracking-wider uppercase text-cedar">Order received</p>
            <CardTitle>Thanks — we're on it</CardTitle>
            <CardDescription>
              Order {placed.invoiceNumber} for {storeInfo?.businessName}. A confirmation is on its way to {contactEmail.trim()}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => { setPlaced(null); setLines([{ unitTypeId: "", flavorId: "", quantity: 1 }]); setNotes(""); }} data-testid="button-order-again">
              Place another order
            </Button>
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const chosenLoc = storeInfo?.locations.find((l) => l.id === locationId);

  return (
    <Shell wide>
      <Card>
        <CardHeader>
          <CardTitle>Order online</CardTitle>
          {storeInfo && (
            <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm mt-2" data-testid="chip-store">
              <span>
                <span className="font-semibold">{storeInfo.businessName}</span>
                {chosenLoc && <span className="text-muted-foreground"> · {chosenLoc.locationName} — {[chosenLoc.street, chosenLoc.city].filter(Boolean).join(", ")}</span>}
              </span>
              <Link href="/wholesale/login" className="text-primary font-medium" data-testid="link-change-store">Change</Link>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            {lines.map((line, i) => {
              const u = line.unitTypeId ? byId.get(line.unitTypeId) : undefined;
              return (
                <div key={i} className="flex flex-wrap items-end gap-2" data-testid={`guest-line-${i}`}>
                  <div className="flex-1 min-w-[150px]">
                    <Label>Product</Label>
                    <Select value={line.unitTypeId} onValueChange={(v) => setLine(i, { unitTypeId: v, flavorId: "" })}>
                      <SelectTrigger className="mt-1.5" data-testid={`select-unit-${i}`}><SelectValue placeholder="Choose…" /></SelectTrigger>
                      <SelectContent>
                        {unitTypes.map((ut) => (
                          <SelectItem key={ut.id} value={ut.id}>{ut.name} (${Number(ut.defaultPrice).toFixed(2)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-44">
                    <Label>Flavor</Label>
                    <Select value={line.flavorId} onValueChange={(v) => setLine(i, { flavorId: v })} disabled={!u}>
                      <SelectTrigger className="mt-1.5" data-testid={`select-flavor-${i}`}><SelectValue placeholder="Flavor…" /></SelectTrigger>
                      <SelectContent>
                        {(u?.flavors ?? []).map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-20">
                    <Label>Qty</Label>
                    <Input
                      className="mt-1.5"
                      inputMode="numeric"
                      value={String(line.quantity)}
                      onChange={(e) => setLine(i, { quantity: Math.max(1, Math.min(99, Number(e.target.value.replace(/\D/g, "")) || 1)) })}
                      data-testid={`input-qty-${i}`}
                    />
                  </div>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { unitTypeId: "", flavorId: "", quantity: 1 }])} data-testid="button-add-line">
              + Add item
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Delivery or pickup</Label>
              <Select value={fulfillment} onValueChange={(v) => setFulfillment(v as "delivery" | "pickup")}>
                <SelectTrigger className="mt-1.5" data-testid="select-fulfillment"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="delivery">Delivery</SelectItem>
                  <SelectItem value="pickup">Pickup at the brewery (Ballard)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fulfillment === "delivery" && soleLocation && (
              <div>
                <Label>Deliver to</Label>
                <p className="mt-2.5 text-sm" data-testid="text-sole-location">
                  {[soleLocation.street, soleLocation.city].filter(Boolean).join(", ")}
                </p>
              </div>
            )}
            {fulfillment === "delivery" && !soleLocation && (
              <div>
                <Label>Deliver to</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger className="mt-1.5" data-testid="select-location"><SelectValue placeholder="Choose location…" /></SelectTrigger>
                  <SelectContent>
                    {(storeInfo?.locations ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.locationName} — {[l.street, l.city].filter(Boolean).join(", ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="fyi-email">Email for this order</Label>
              <Input
                id="fyi-email"
                type="email"
                className="mt-1.5"
                placeholder="you@yourstore.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                data-testid="input-guest-email"
              />
              <p className="text-xs text-muted-foreground mt-1.5">The order confirmation goes here.</p>
            </div>
            <div>
              <Label htmlFor="guest-po">PO # (optional)</Label>
              <Input id="guest-po" className="mt-1.5" placeholder="Your purchase order number" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} data-testid="input-guest-po" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="guest-notes">Notes</Label>
              <Textarea id="guest-notes" className="mt-1.5" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-guest-notes" />
            </div>
          </div>

          {/* Honeypot: invisible to people, irresistible to bots. */}
          <div className="hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap border-t pt-4">
            <div className="text-sm">
              <span className="text-muted-foreground">Total: </span>
              <span className="font-semibold text-base">${total.toFixed(2)}</span>
              {min > 0 && total > 0 && total < min && (
                <span className="text-destructive ml-2" data-testid="text-min-order">Minimum order is ${min.toFixed(2)}</span>
              )}
            </div>
            <Button
              size="lg"
              onClick={() => submit.mutate()}
              disabled={submit.isPending || !linesOk || !emailOk || !locationOk || (min > 0 && total < min)}
              data-testid="button-submit-guest-order"
            >
              {submit.isPending ? "Placing…" : "Place order"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Shell>
  );
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className={`w-full ${wide ? "max-w-2xl" : "max-w-md"}`}>{children}</div>
    </div>
  );
}
