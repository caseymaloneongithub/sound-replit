import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleCustomer, WholesaleUnitType, Flavor, WholesaleCustomerPricing, WholesaleLocation } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Trash2 } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CartItem {
  unitTypeId: string;
  flavorId: string;
  quantity: number;
}

export default function WholesalePlaceOrder() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [fulfillmentMethod, setFulfillmentMethod] = useState<"delivery" | "pickup">("delivery");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [poNumber, setPoNumber] = useState("");
  // Customer-placed orders always email a confirmation; staff-entered ones make it a
  // choice (historical entries and corrections shouldn't surprise the customer).
  const [sendConfirmation, setSendConfirmation] = useState(true);
  const [selectedUnitTypeId, setSelectedUnitTypeId] = useState<string>("");
  const [selectedFlavorId, setSelectedFlavorId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: unitTypes = [] } = useQuery<(WholesaleUnitType & { flavors?: Flavor[] })[]>({
    queryKey: ["/api/wholesale-unit-types"],
    queryFn: async () => apiRequest('GET', '/api/wholesale-unit-types?includeFlavors=true'),
  });

  // Fetch customer-specific pricing when a customer is selected
  const { data: customerPricing = [] } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: ["/api/wholesale-customer-pricing", selectedCustomerId],
    queryFn: async () => {
      if (!selectedCustomerId) return [];
      return await apiRequest("GET", `/api/wholesale-customer-pricing/${selectedCustomerId}`);
    },
    enabled: !!selectedCustomerId,
  });

  // Fetch locations for the selected customer
  const { data: customerLocations = [] } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale/customers", selectedCustomerId, "locations"],
    enabled: !!selectedCustomerId,
  });

  // Get available flavors for selected unit type
  const availableFlavors = selectedUnitTypeId
    ? unitTypes.find(ut => ut.id === selectedUnitTypeId)?.flavors || []
    : [];

  // Reset selections when customer or unit type changes
  useEffect(() => {
    setCart([]);
    setSelectedLocationId("");
    setSelectedUnitTypeId("");
    setSelectedFlavorId("");
    setQuantity(1);
  }, [selectedCustomerId]);

  // Most customers have exactly one location — pre-select it so staff never
  // click through a one-option dropdown.
  useEffect(() => {
    if (customerLocations.length === 1 && !selectedLocationId) {
      setSelectedLocationId(customerLocations[0].id);
    }
  }, [customerLocations, selectedLocationId]);

  useEffect(() => {
    setSelectedFlavorId("");
  }, [selectedUnitTypeId]);

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) {
        throw new Error("Please select a customer");
      }
      if (cart.length === 0) {
        throw new Error("Cart is empty");
      }
      // Delivery needs an address; pickup is collected at the brewery and needs none.
      if (fulfillmentMethod === "delivery" && !selectedLocationId) {
        throw new Error("Please select a delivery location, or set this order to pickup");
      }

      return await apiRequest("POST", "/api/wholesale/orders", {
        sendConfirmation,
        order: {
          customerId: selectedCustomerId,
          poNumber: poNumber.trim() || undefined,
          fulfillmentMethod,
          locationId: fulfillmentMethod === "delivery" ? selectedLocationId || undefined : undefined,
          notes: notes || undefined,
        },
        items: cart,
      });
    },
    onSuccess: () => {
      toast({
        title: "Order Created",
        description: "Wholesale order has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setCart([]);
      setNotes("");
      setPoNumber("");
      setSelectedCustomerId("");
      setSelectedLocationId("");
      setSelectedUnitTypeId("");
      setSelectedFlavorId("");
      setQuantity(1);
      setLocation("/staff-portal/wholesale/orders");
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
    if (!selectedCustomerId) return 0;
    
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
    if (!selectedUnitTypeId || !selectedFlavorId || quantity <= 0) {
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
          ? { ...item, quantity: item.quantity + quantity }
          : item
      ));
    } else {
      setCart([...cart, { unitTypeId: selectedUnitTypeId, flavorId: selectedFlavorId, quantity }]);
    }

    // Reset selection
    setSelectedFlavorId("");
    setQuantity(1);
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

  // Typing into the quantity field must let the box go EMPTY mid-edit (stored as 0) so you
  // can backspace and retype — coercing empty to 0/1 on every keystroke made that
  // impossible. Removal stays on the minus button; an empty field snaps to 1 on blur.
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

  const getFlavorName = (flavorId: string): string => {
    // Find flavor from all unit types since we don't have a separate flavors query
    for (const unitType of unitTypes) {
      const flavor = unitType.flavors?.find(f => f.id === flavorId);
      if (flavor) return flavor.name;
    }
    return "";
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Place Wholesale Order
          </h1>
          <p className="text-muted-foreground">
            Create a new wholesale order for a customer
          </p>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Select Customer</CardTitle>
              <CardDescription>Choose the customer for this order</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Customer</label>
                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger data-testid="select-customer">
                    <SelectValue placeholder="Select a customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.businessName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedCustomerId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Fulfillment</label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={fulfillmentMethod === "delivery" ? "default" : "outline"}
                      onClick={() => setFulfillmentMethod("delivery")}
                      data-testid="button-method-delivery"
                    >
                      Delivery
                    </Button>
                    <Button
                      type="button"
                      variant={fulfillmentMethod === "pickup" ? "default" : "outline"}
                      onClick={() => setFulfillmentMethod("pickup")}
                      data-testid="button-method-pickup"
                    >
                      Pickup
                    </Button>
                  </div>
                  {fulfillmentMethod === "pickup" && (
                    <p className="text-xs text-muted-foreground">
                      Collected at the brewery — this order stays off the delivery report and route.
                    </p>
                  )}
                </div>
              )}

              {selectedCustomerId && fulfillmentMethod === "delivery" && customerLocations.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Delivery Location</label>
                  <Select value={selectedLocationId} onValueChange={setSelectedLocationId}>
                    <SelectTrigger data-testid="select-location">
                      <SelectValue placeholder="Select delivery location" />
                    </SelectTrigger>
                    <SelectContent>
                      {customerLocations.filter(loc => loc.isActive).map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          <div className="flex flex-col">
                            <span>{location.locationName}</span>
                            {location.address && (
                              <span className="text-xs text-muted-foreground">
                                {location.address}, {location.city}
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </CardContent>
          </Card>

          {selectedCustomerId && (
            <div className="grid md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Add Items to Order</CardTitle>
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
                                const hasCustomPrice = customerPricing.some(p => p.unitTypeId === unitType.id);
                                
                                return (
                                  <SelectItem key={unitType.id} value={unitType.id}>
                                    <div className="flex items-center gap-2">
                                      <span>{unitType.name}</span>
                                      <span className="text-muted-foreground">
                                        (${price.toFixed(2)})
                                      </span>
                                      {hasCustomPrice && (
                                        <Badge variant="secondary" className="text-xs ml-1">
                                          Custom Price
                                        </Badge>
                                      )}
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
                                  type="text"
                                  inputMode="numeric"
                                  value={quantity === 0 ? "" : quantity}
                                  onChange={(e) => {
                                    const d = e.target.value.replace(/[^0-9]/g, "");
                                    setQuantity(d === "" ? 0 : parseInt(d, 10));
                                  }}
                                  onBlur={() => { if (quantity < 1) setQuantity(1); }}
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
                    <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>
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
                        
                        <div className="pt-3 border-t">
                          <div className="flex items-center justify-between">
                            <span className="text-lg font-semibold">Total</span>
                            <span className="text-2xl font-bold" data-testid="text-cart-total">
                              ${getCartTotal().toFixed(2)}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>PO # &amp; Order Notes</CardTitle>
                    <CardDescription>Add any special instructions</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label htmlFor="staff-po">PO # (optional)</Label>
                      <Input
                        id="staff-po"
                        className="mt-1.5"
                        placeholder="Customer's purchase order number"
                        value={poNumber}
                        onChange={(e) => setPoNumber(e.target.value)}
                        data-testid="input-staff-po"
                      />
                    </div>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={4}
                      placeholder="Enter any special instructions or notes..."
                      data-testid="input-notes"
                    />
                    <div className="flex items-center justify-between rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <Label htmlFor="send-confirmation">Email the customer a confirmation</Label>
                        <p className="text-sm text-muted-foreground">
                          Turn off for historical entries or corrections the customer shouldn't be re-notified about.
                        </p>
                      </div>
                      <Switch
                        id="send-confirmation"
                        checked={sendConfirmation}
                        onCheckedChange={setSendConfirmation}
                        data-testid="switch-send-confirmation"
                      />
                    </div>
                  </CardContent>
                </Card>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={() => createOrderMutation.mutate()}
                  disabled={createOrderMutation.isPending || cart.length === 0}
                  data-testid="button-place-order"
                >
                  {createOrderMutation.isPending ? "Placing Order..." : "Place Order"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </StaffLayout>
  );
}
