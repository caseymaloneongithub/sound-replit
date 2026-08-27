import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleUnitType, Flavor, WholesaleCustomerPricing, WholesaleLocation } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Minus, Trash2, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { WholesaleCustomerLayout } from "@/components/wholesale/wholesale-customer-layout";
import { loadWholesaleCart, saveWholesaleCart, clearWholesaleCart } from "@/lib/wholesale-cart";
import type { WholesaleCustomer } from "@shared/schema";
import { PICKUP_POLICY } from "@shared/pickup-policy";

interface CartItem {
  unitTypeId: string;
  flavorId: string;
  quantity: number;
}

export default function WholesaleCustomerPlaceOrder() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  // Delivery or collect from the brewery. Pickup carries no address, so it's also the way
  // a customer with no location on file can still place an order.
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [selectedUnitTypeId, setSelectedUnitTypeId] = useState<string>("");
  const [selectedFlavorId, setSelectedFlavorId] = useState<string>("");
  const [quantity, setQuantity] = useState<string>("1");
  const [cartHydrated, setCartHydrated] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: customer } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  // Used only to tell a brand-new account from a returning one, so the page can welcome
  // the first and get out of the way of the second.
  const { data: pastOrders = [], isLoading: ordersLoading } = useQuery<Array<{ id: string }>>({
    queryKey: ["/api/wholesale-customer/orders"],
  });

  const { data: unitTypes = [] } = useQuery<(WholesaleUnitType & { flavors?: Flavor[] })[]>({
    queryKey: ["/api/wholesale/customer/unit-types"],
  });

  // Fetch customer-specific pricing for the logged-in wholesale customer.
  // NOTE: this key was "/api/wholesale/customer/unit-pricing", which does not exist —
  // it 404'd, pricing stayed empty, and every customer was shown list prices while the
  // server correctly invoiced their negotiated rate. Displayed total != charged total.
  const { data: customerPricing = [] } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: ["/api/wholesale/customer/pricing"],
  });

  // Fetch customer's delivery locations
  const { data: locations = [], isLoading: locationsLoading } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale-customer/locations"],
  });

  // Fetch minimum order amount setting
  const { data: minOrderSetting } = useQuery<{ value: number }>({
    queryKey: ["/api/settings/wholesale-minimum-order"],
  });
  const minimumOrderAmount = minOrderSetting?.value || 0;

  // Auto-select location if customer has exactly one
  useEffect(() => {
    // Store-first ordering: ?location=<id> arrives from the sign-in redirect with the
    // delivery location the visitor picked before their email. Take it once, if valid.
    const preferred = new URLSearchParams(window.location.search).get("location");
    if (preferred && !selectedLocationId && locations.some((l) => l.id === preferred)) {
      setSelectedLocationId(preferred);
      setFulfillmentMethod("delivery");
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }
    if (locations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(locations[0].id);
    }
  }, [locations, selectedLocationId]);

  // Restore a saved or reordered cart once the catalogue is loaded, dropping anything
  // no longer on offer. Validation happens here rather than at the Reorder click because
  // this is the only page that holds the live catalogue.
  useEffect(() => {
    if (cartHydrated || !customer?.id || unitTypes.length === 0) return;

    const saved = loadWholesaleCart(customer.id);
    if (saved.length > 0) {
      const isStillAvailable = (item: { unitTypeId: string; flavorId: string }) => {
        const ut = unitTypes.find((u) => u.id === item.unitTypeId);
        return !!ut?.flavors?.some((f) => f.id === item.flavorId);
      };
      const kept = saved.filter(isStillAvailable);
      const dropped = saved.length - kept.length;
      setCart(kept);
      if (dropped > 0) {
        toast({
          title: dropped === saved.length ? "Those items are no longer available" : "Some items are no longer available",
          description: `${dropped} ${dropped === 1 ? "item" : "items"} we no longer carry ${dropped === 1 ? "was" : "were"} left out. Everything else is in your cart.`,
        });
      }
    }
    setCartHydrated(true);
  }, [customer?.id, unitTypes, cartHydrated, toast]);

  // Persist after hydration only, so we never overwrite a saved cart with the empty
  // initial state during the first render pass.
  useEffect(() => {
    if (cartHydrated && customer?.id) saveWholesaleCart(customer.id, cart);
  }, [cart, cartHydrated, customer?.id]);

  // Get available flavors for selected unit type
  const availableFlavors = selectedUnitTypeId
    ? unitTypes.find(ut => ut.id === selectedUnitTypeId)?.flavors || []
    : [];

  // Reset flavor selection when unit type changes
  useEffect(() => {
    setSelectedFlavorId("");
  }, [selectedUnitTypeId]);

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) {
        throw new Error("Cart is empty");
      }

      return await apiRequest("POST", "/api/wholesale/customer/orders", {
        notes: notes || undefined,
        fulfillmentMethod,
        locationId:
          fulfillmentMethod === "delivery" && selectedLocationId && selectedLocationId !== "none"
            ? selectedLocationId
            : undefined,
        items: cart,
      });
    },
    onSuccess: (result: any) => {
      // A contact still waiting for approval: the order is held on their request and
      // placed the moment staff confirm them — tell them that, not "placed".
      const held = !!result?.held;
      toast(
        held
          ? { title: "Order saved", description: `We'll send it through as soon as we confirm you on ${customer?.businessName || "the store"}.` }
          : { title: "Order Created", description: "Your wholesale order has been placed successfully" }
      );
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/claim/status"] });
      clearWholesaleCart(customer?.id);
      setCart([]);
      setNotes("");
      setSelectedLocationId("");
      setSelectedUnitTypeId("");
      setSelectedFlavorId("");
      setQuantity("1");
      setLocation(held ? "/wholesale/claim" : "/wholesale-customer");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    },
  });

  const getPrice = (unitTypeId: string): number => {
    // Check for customer-specific pricing
    const customPrice = customerPricing.find(p => p.unitTypeId === unitTypeId);
    if (customPrice) {
      return Number(customPrice.customPrice);
    }
    
    // Fall back to default price
    const unitType = unitTypes.find(ut => ut.id === unitTypeId);
    return unitType ? Number(unitType.defaultPrice) : 0;
  };

  const addToCart = () => {
    const qty = parseInt(quantity) || 0;
    if (!selectedUnitTypeId || !selectedFlavorId || qty <= 0) {
      toast({
        title: "Invalid Selection",
        description: "Please select a unit type, flavor, and quantity",
        variant: "destructive",
      });
      return;
    }

    const existingItem = cart.find(
      item => item.unitTypeId === selectedUnitTypeId && item.flavorId === selectedFlavorId
    );

    if (existingItem) {
      setCart(cart.map(item => 
        item.unitTypeId === selectedUnitTypeId && item.flavorId === selectedFlavorId
          ? { ...item, quantity: item.quantity + qty }
          : item
      ));
    } else {
      setCart([...cart, { unitTypeId: selectedUnitTypeId, flavorId: selectedFlavorId, quantity: qty }]);
    }

    // Reset selection
    setSelectedFlavorId("");
    setQuantity("1");
  };

  const updateQuantity = (unitTypeId: string, flavorId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      removeFromCart(unitTypeId, flavorId);
    } else {
      setCart(cart.map(item =>
        item.unitTypeId === unitTypeId && item.flavorId === flavorId
          ? { ...item, quantity: newQuantity }
          : item
      ));
    }
  };

  // Typing into the quantity field. Unlike the +/- buttons, this must let the box go
  // EMPTY mid-edit (stored as 0) so you can backspace and retype a fresh number — the old
  // handler coerced empty to 0 and removed the line on every keystroke. Removal stays on
  // the minus button; a field left empty snaps back to 1 on blur.
  const setCartQuantity = (unitTypeId: string, flavorId: string, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, "");
    const n = digits === "" ? 0 : parseInt(digits, 10);
    setCart(cart.map(item =>
      item.unitTypeId === unitTypeId && item.flavorId === flavorId
        ? { ...item, quantity: n }
        : item
    ));
  };

  const removeFromCart = (unitTypeId: string, flavorId: string) => {
    setCart(cart.filter(item => !(item.unitTypeId === unitTypeId && item.flavorId === flavorId)));
  };

  const getCartTotal = (): number => {
    return cart.reduce((total, item) => {
      const price = getPrice(item.unitTypeId);
      return total + (price * item.quantity);
    }, 0);
  };

  const getUnitTypeName = (unitTypeId: string): string => {
    return unitTypes.find(ut => ut.id === unitTypeId)?.name || "";
  };

  // Treated as first-run until they've actually placed something. Requires the query to
  // have settled, so a returning customer isn't greeted as a newcomer mid-load.
  const isFirstOrder = !ordersLoading && !!customer && pastOrders.length === 0;

  const getFlavorName = (flavorId: string): string => {
    // Find flavor from all unit types since we don't have a separate flavors query
    for (const unitType of unitTypes) {
      const flavor = unitType.flavors?.find(f => f.id === flavorId);
      if (flavor) return flavor.name;
    }
    return "";
  };

  return (
    <WholesaleCustomerLayout>
      {(customer as any)?.linkStatus === "pending" && (
        <div className="mb-4 rounded-md border bg-muted/50 px-4 py-3 text-sm" data-testid="banner-pending-claim">
          <span className="font-medium">Waiting for confirmation on {customer?.businessName}.</span>{" "}
          Build your order now — it goes through as soon as we confirm you, usually the same business day.
        </div>
      )}
      <div className="py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">
            {isFirstOrder ? `Welcome, ${customer?.businessName ?? "there"}` : "Place Order"}
          </h1>
          <p className="text-muted-foreground">
            {isFirstOrder
              ? "You're all set up. Here's everything you need to place your first order."
              : "Select unit types, flavors, and place your wholesale order"}
          </p>
        </div>

        {!isFirstOrder && pastOrders.length > 0 && (
          <Alert className="mb-6">
            <AlertDescription className="flex items-center justify-between gap-4 flex-wrap">
              <span>Ordering the same as last time? Copy a past order instead of rebuilding it.</span>
              <Button variant="outline" size="sm" onClick={() => setLocation("/wholesale-customer/orders")} data-testid="button-go-reorder">
                View past orders
              </Button>
            </AlertDescription>
          </Alert>
        )}

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Your account</CardTitle>
            <CardDescription>
              Prices, minimum order, and delivery details for{" "}
              {customer?.businessName ?? "your business"}.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-3">
            <div>
              {/* Just "Pricing", and no badge marking which lines are account-specific.
                  Flagging a price as personalised invites the customer to wonder what
                  everyone else pays; the number shown is simply the price. getPrice()
                  still applies any agreed rate — this only changes how it's presented. */}
              <p className="text-sm font-medium mb-2">Pricing</p>
              {unitTypes.length === 0 && (
                <p className="text-sm text-muted-foreground">Loading…</p>
              )}
              <ul className="space-y-1 text-sm text-muted-foreground">
                {unitTypes
                  .filter(ut => ut.isActive)
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map(ut => (
                    <li key={ut.id} className="flex items-center gap-2">
                      <span>{ut.name}</span>
                      <span className="text-foreground font-medium">${getPrice(ut.id).toFixed(2)}</span>
                    </li>
                  ))}
              </ul>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">Minimum order</p>
              <p className="text-sm text-muted-foreground">
                {minimumOrderAmount > 0
                  ? `$${minimumOrderAmount.toFixed(2)} per order`
                  : "No minimum — order any quantity."}
              </p>
            </div>

            <div>
              <p className="text-sm font-medium mb-2">
                {fulfillmentMethod === "pickup" ? "Picking up from" : "Delivering to"}
              </p>
              {fulfillmentMethod === "pickup" ? (
                <p className="text-sm text-muted-foreground">
                  {PICKUP_POLICY.address} &mdash; Mon&ndash;Thu, {PICKUP_POLICY.timeWindow}
                </p>
              ) : locationsLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : locations.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-sm text-destructive">
                    No delivery address on file — add one, or choose pickup in your cart.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => setLocation("/wholesale-customer/locations")} data-testid="button-add-location-prompt">
                    Add a delivery address
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {(() => {
                    const active = locations.find(l => l.id === selectedLocationId) ?? locations[0];
                    return `${active.locationName} — ${active.address}, ${active.city}`;
                  })()}
                  {locations.length > 1 && " (change it in the cart)"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Add Items to Order</CardTitle>
              <CardDescription>Select unit type and flavor combinations</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {unitTypes.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No unit types available</p>
              ) : (
                <>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Unit Type</label>
                    <Select
                      value={selectedUnitTypeId}
                      onValueChange={setSelectedUnitTypeId}
                    >
                      <SelectTrigger data-testid="select-unit-type">
                        <SelectValue placeholder="Select unit type" />
                      </SelectTrigger>
                      <SelectContent>
                        {unitTypes
                          .filter(ut => ut.isActive)
                          .sort((a, b) => a.displayOrder - b.displayOrder)
                          .map((unitType) => {
                            const price = getPrice(unitType.id);

                            return (
                              <SelectItem key={unitType.id} value={unitType.id}>
                                <div className="flex items-center gap-2">
                                  <span>{unitType.name}</span>
                                  <span className="text-muted-foreground">
                                    (${price.toFixed(2)})
                                  </span>
                                </div>
                              </SelectItem>
                            );
                          })}
                      </SelectContent>
                    </Select>
                  </div>

                  {selectedUnitTypeId && (
                    <>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Flavor</label>
                        {availableFlavors.length === 0 ? (
                          <p className="text-sm text-muted-foreground">No flavors available for this unit type</p>
                        ) : (
                          <Select
                            value={selectedFlavorId}
                            onValueChange={setSelectedFlavorId}
                          >
                            <SelectTrigger data-testid="select-flavor">
                              <SelectValue placeholder="Select flavor" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableFlavors.map((flavor) => (
                                <SelectItem key={flavor.id} value={flavor.id}>
                                  {flavor.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>

                      {selectedFlavorId && (
                        <>
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Quantity</label>
                            <Input
                              type="number"
                              value={quantity}
                              onChange={(e) => setQuantity(e.target.value)}
                              onBlur={() => {
                                const num = parseInt(quantity);
                                if (isNaN(num) || num < 1) setQuantity("1");
                              }}
                              min="1"
                              data-testid="input-quantity"
                            />
                          </div>

                          <Button
                            className="w-full"
                            onClick={addToCart}
                            data-testid="button-add-to-cart"
                          >
                            <Plus className="w-4 h-4 mr-2" />
                            Add to Cart
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  Cart ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </CardTitle>
                <CardDescription>Review and adjust quantities</CardDescription>
              </CardHeader>
              <CardContent>
                {cart.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Cart is empty</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {cart.map((item, index) => {
                      const unitTypeName = getUnitTypeName(item.unitTypeId);
                      const flavorName = getFlavorName(item.flavorId);
                      const price = getPrice(item.unitTypeId);
                      
                      return (
                        <div 
                          key={`${item.unitTypeId}-${item.flavorId}`}
                          className="flex items-center gap-4 p-3 rounded-lg border"
                          data-testid={`cart-item-${index}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{flavorName}</p>
                            <p className="text-sm text-muted-foreground">{unitTypeName}</p>
                            <p className="text-sm font-medium mt-1">
                              {item.quantity} {item.quantity === 1 ? 'case' : 'cases'}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              ${(price * item.quantity).toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => updateQuantity(item.unitTypeId, item.flavorId, item.quantity - 1)}
                              data-testid={`button-decrease-${index}`}
                            >
                              <Minus className="w-4 h-4" />
                            </Button>
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={item.quantity === 0 ? "" : item.quantity}
                              onChange={(e) => setCartQuantity(item.unitTypeId, item.flavorId, e.target.value)}
                              onBlur={() => { if (item.quantity < 1) updateQuantity(item.unitTypeId, item.flavorId, 1); }}
                              className="w-16 text-center"
                              data-testid={`input-cart-quantity-${index}`}
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => updateQuantity(item.unitTypeId, item.flavorId, item.quantity + 1)}
                              data-testid={`button-increase-${index}`}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => removeFromCart(item.unitTypeId, item.flavorId)}
                              data-testid={`button-remove-${index}`}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {cart.length > 0 && (
              <>
                {/* Always shown, unlike the old delivery-only card that appeared just when a
                    customer had 2+ addresses — pickup has to be reachable by everyone,
                    including customers with no address on file at all. */}
                <Card>
                  <CardHeader>
                    <CardTitle>How would you like this order?</CardTitle>
                    <CardDescription>Delivered to one of your locations, or collect it from the brewery</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        type="button"
                        variant={fulfillmentMethod === "delivery" ? "default" : "outline"}
                        className="h-auto py-3"
                        onClick={() => setFulfillmentMethod("delivery")}
                        data-testid="button-method-delivery"
                      >
                        Deliver to us
                      </Button>
                      <Button
                        type="button"
                        variant={fulfillmentMethod === "pickup" ? "default" : "outline"}
                        className="h-auto py-3"
                        onClick={() => setFulfillmentMethod("pickup")}
                        data-testid="button-method-pickup"
                      >
                        We'll pick up
                      </Button>
                    </div>

                    {fulfillmentMethod === "pickup" ? (
                      <div className="text-sm text-muted-foreground p-3 bg-muted rounded-md" data-testid="text-pickup-details">
                        <p className="font-medium text-foreground">Collect from the brewery</p>
                        <p className="mt-1">{PICKUP_POLICY.address}</p>
                        <p>{PICKUP_POLICY.instructions}</p>
                        <p className="mt-1">Monday&ndash;Thursday, {PICKUP_POLICY.timeWindow}</p>
                        <p className="mt-1">{PICKUP_POLICY.callInstructions} &mdash; {PICKUP_POLICY.phoneFormatted}</p>
                      </div>
                    ) : locations.length === 0 ? (
                      <div className="space-y-2">
                        <p className="text-sm text-destructive">
                          No delivery address on file. Add one, or choose pickup above.
                        </p>
                        <Button variant="outline" size="sm" onClick={() => setLocation("/wholesale-customer/locations")} data-testid="button-add-location-cart">
                          Add a delivery address
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="location-select">Location <span className="text-destructive">*</span></Label>
                        <Select
                          value={selectedLocationId}
                          onValueChange={setSelectedLocationId}
                        >
                          <SelectTrigger id="location-select" data-testid="select-location">
                            <SelectValue placeholder="Select a location" />
                          </SelectTrigger>
                          <SelectContent>
                            {locations.map((location) => (
                              <SelectItem key={location.id} value={location.id}>
                                <div className="flex items-center gap-2">
                                  <MapPin className="h-4 w-4 text-muted-foreground" />
                                  <div>
                                    <div className="font-medium">{location.locationName}</div>
                                    <div className="text-xs text-muted-foreground">
                                      {location.city}, {location.state}
                                    </div>
                                  </div>
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selectedLocationId && locations.find(l => l.id === selectedLocationId) && (
                          <div className="text-sm text-muted-foreground mt-2 p-3 bg-muted rounded-md">
                            <div className="font-medium">
                              {locations.find(l => l.id === selectedLocationId)?.locationName}
                            </div>
                            <div className="mt-1">
                              {locations.find(l => l.id === selectedLocationId)?.address}
                            </div>
                            <div>
                              {locations.find(l => l.id === selectedLocationId)?.city},{' '}
                              {locations.find(l => l.id === selectedLocationId)?.state}{' '}
                              {locations.find(l => l.id === selectedLocationId)?.zipCode}
                            </div>
                            {locations.find(l => l.id === selectedLocationId)?.contactName && (
                              <div className="mt-1">
                                Contact: {locations.find(l => l.id === selectedLocationId)?.contactName}
                                {locations.find(l => l.id === selectedLocationId)?.contactPhone && (
                                  <> • {locations.find(l => l.id === selectedLocationId)?.contactPhone}</>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                        {!selectedLocationId && (
                          <p className="text-sm text-destructive">Please select a delivery location</p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Order Notes</CardTitle>
                    <CardDescription>Add any special instructions (optional)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Enter any special instructions or notes..."
                      rows={3}
                      data-testid="textarea-notes"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Order Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-lg font-bold">
                        <span>Total:</span>
                        <span data-testid="text-total">${getCartTotal().toFixed(2)}</span>
                      </div>
                      {minimumOrderAmount > 0 && (
                        <div className="flex justify-between text-sm text-muted-foreground">
                          <span>Minimum Order:</span>
                          <span data-testid="text-minimum-order">${minimumOrderAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                    {minimumOrderAmount > 0 && getCartTotal() < minimumOrderAmount && (
                      <Alert variant="destructive" className="mt-4">
                        <AlertDescription>
                          Your order total of ${getCartTotal().toFixed(2)} does not meet the minimum order amount of ${minimumOrderAmount.toFixed(2)}. Please add more items to your order.
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button
                      className="w-full mt-4"
                      onClick={() => createOrderMutation.mutate()}
                      disabled={
                        createOrderMutation.isPending ||
                        cart.length === 0 ||
                        // Delivery needs somewhere to go; pickup needs nothing.
                        (fulfillmentMethod === "delivery" && !selectedLocationId) ||
                        (minimumOrderAmount > 0 && getCartTotal() < minimumOrderAmount)
                      }
                      data-testid="button-place-order"
                    >
                      {createOrderMutation.isPending ? 'Placing Order...' : 'Place Order'}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </WholesaleCustomerLayout>
  );
}
