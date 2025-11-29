import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleUnitType, Flavor, WholesaleCustomerPricing, WholesaleLocation } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Trash2, ShoppingCart, MapPin } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { WholesaleCustomerLayout } from "@/components/wholesale/wholesale-customer-layout";

interface CartItem {
  unitTypeId: string;
  flavorId: string;
  quantity: number;
}

export default function WholesaleCustomerPlaceOrder() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const [selectedUnitTypeId, setSelectedUnitTypeId] = useState<string>("");
  const [selectedFlavorId, setSelectedFlavorId] = useState<string>("");
  const [quantity, setQuantity] = useState<number>(1);
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: unitTypes = [] } = useQuery<(WholesaleUnitType & { flavors?: Flavor[] })[]>({
    queryKey: ["/api/wholesale-unit-types"],
    queryFn: async () => apiRequest('GET', '/api/wholesale-unit-types?includeFlavors=true'),
  });

  // Fetch customer-specific pricing for the logged-in wholesale customer
  const { data: customerPricing = [] } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: ["/api/wholesale/customer/unit-pricing"],
  });

  // Fetch customer's delivery locations
  const { data: locations = [] } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale-customer/locations"],
  });

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
        locationId: selectedLocationId && selectedLocationId !== "none" ? selectedLocationId : undefined,
        items: cart,
      });
    },
    onSuccess: () => {
      toast({
        title: "Order Created",
        description: "Your wholesale order has been placed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/orders"] });
      setCart([]);
      setNotes("");
      setSelectedLocationId("");
      setSelectedUnitTypeId("");
      setSelectedFlavorId("");
      setQuantity(1);
      setLocation("/wholesale-customer");
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
    <WholesaleCustomerLayout>
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Place Order</h1>
          <p className="text-muted-foreground">
            Select unit types, flavors, and place your wholesale order
          </p>
        </div>

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
                            <label className="text-sm font-medium">Quantity (cases)</label>
                            <Input
                              type="number"
                              value={quantity}
                              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
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
                    <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
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
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateQuantity(item.unitTypeId, item.flavorId, parseInt(e.target.value) || 0)}
                              className="w-16 text-center"
                              min="0"
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
                {locations.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Delivery Location</CardTitle>
                      <CardDescription>Select the delivery location for this order (optional)</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        <Label htmlFor="location-select">Location</Label>
                        <Select
                          value={selectedLocationId}
                          onValueChange={setSelectedLocationId}
                        >
                          <SelectTrigger id="location-select" data-testid="select-location">
                            <SelectValue placeholder="Select a location (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No specific location</SelectItem>
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
                        {selectedLocationId && selectedLocationId !== "none" && locations.find(l => l.id === selectedLocationId) && (
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
                      </div>
                    </CardContent>
                  </Card>
                )}

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
                    </div>
                    <Button
                      className="w-full mt-4"
                      onClick={() => createOrderMutation.mutate()}
                      disabled={createOrderMutation.isPending || cart.length === 0}
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
