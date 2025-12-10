import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Subscription, Product, RetailOrder, RetailOrderItem } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Repeat, Plus, Trash2, X, CreditCard, Calendar, ShoppingCart, Mail } from "lucide-react";
import { format, startOfWeek } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { PickupInfo } from "@/components/pickup-info";

type SubscriptionItem = {
  id: string;
  subscriptionId: string;
  productId: string;
  quantity: number;
  product?: Product;
};

type SubscriptionWithItems = Subscription & {
  items: SubscriptionItem[];
};

type OrderWithDetails = {
  order: RetailOrder;
  items: Array<RetailOrderItem & { product: Product }>;
};

export default function MyAccount() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedWeeksDelay, setSelectedWeeksDelay] = useState<Record<string, number>>({});
  const [selectedFrequency, setSelectedFrequency] = useState<Record<string, string>>({});
  const [addProductDialog, setAddProductDialog] = useState<{ open: boolean; subscriptionId: string | null }>({ 
    open: false, 
    subscriptionId: null 
  });
  const [cancelDialog, setCancelDialog] = useState<{ open: boolean; subscriptionId: string | null }>({ 
    open: false, 
    subscriptionId: null 
  });
  const [selectedNewProduct, setSelectedNewProduct] = useState<string>("");
  const [selectedNewQuantity, setSelectedNewQuantity] = useState<number>(1);
  const [selectedNewFlavor, setSelectedNewFlavor] = useState<string>("");

  const { data: subscriptions, isLoading: subscriptionsLoading } = useQuery<SubscriptionWithItems[]>({
    queryKey: ["/api/my-subscriptions"],
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<OrderWithDetails[]>({
    queryKey: ["/api/my-orders"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: retailProducts } = useQuery<any[]>({
    queryKey: ["/api/retail-products"],
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: async ({ subscriptionId, updates }: { subscriptionId: string; updates: any }) => {
      return await apiRequest("PATCH", `/api/my-subscriptions/${subscriptionId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      toast({
        title: "Subscription updated",
        description: "Your subscription has been updated successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update subscription",
        variant: "destructive",
      });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async ({ subscriptionId, productId, quantity }: { subscriptionId: string; productId: string; quantity: number }) => {
      return await apiRequest("POST", `/api/my-subscriptions/${subscriptionId}/items`, { productId, quantity });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      setAddProductDialog({ open: false, subscriptionId: null });
      setSelectedNewProduct("");
      setSelectedNewQuantity(1);
      toast({
        title: "Product added",
        description: "Product added to your subscription",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add product",
        variant: "destructive",
      });
    },
  });

  const addRetailItemMutation = useMutation({
    mutationFn: async ({ subscriptionId, retailProductId, selectedFlavorId, quantity }: { 
      subscriptionId: string; 
      retailProductId: string; 
      selectedFlavorId?: string | null;
      quantity: number;
    }) => {
      return await apiRequest("POST", `/api/retail-subscriptions/${subscriptionId}/items`, { 
        retailProductId, 
        selectedFlavorId: selectedFlavorId || null,
        quantity 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      setAddProductDialog({ open: false, subscriptionId: null });
      setSelectedNewProduct("");
      setSelectedNewQuantity(1);
      setSelectedNewFlavor("");
      toast({
        title: "Product added",
        description: "Product added to your subscription",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add product",
        variant: "destructive",
      });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async ({ subscriptionId, itemId }: { subscriptionId: string; itemId: string }) => {
      return await apiRequest("DELETE", `/api/my-subscriptions/${subscriptionId}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      toast({
        title: "Product removed",
        description: "Product removed from your subscription",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove product",
        variant: "destructive",
      });
    },
  });

  const cancelSubscriptionMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      return await apiRequest("DELETE", `/api/my-subscriptions/${subscriptionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      setCancelDialog({ open: false, subscriptionId: null });
      toast({
        title: "Subscription cancelled",
        description: "Your subscription has been cancelled",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to cancel subscription",
        variant: "destructive",
      });
    },
  });

  const createBillingPortalMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/create-billing-portal", {});
    },
    onSuccess: (data: { url: string }) => {
      window.open(data.url, '_blank');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open billing portal",
        variant: "destructive",
      });
    },
  });

  const updateFlavorMutation = useMutation({
    mutationFn: async ({ subscriptionId, itemId, selectedFlavorId }: { subscriptionId: string; itemId: string; selectedFlavorId: string }) => {
      return await apiRequest("PATCH", `/api/retail-subscriptions/${subscriptionId}/items/${itemId}/flavor`, { selectedFlavorId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      toast({
        title: "Flavor updated",
        description: "Your flavor selection has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update flavor",
        variant: "destructive",
      });
    },
  });

  const updateQuantityMutation = useMutation({
    mutationFn: async ({ subscriptionId, itemId, quantity }: { subscriptionId: string; itemId: string; quantity: number }) => {
      return await apiRequest("PATCH", `/api/retail-subscriptions/${subscriptionId}/items/${itemId}/quantity`, { quantity });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/my-subscriptions"] });
      toast({
        title: "Quantity updated",
        description: "Your subscription quantity has been updated",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update quantity",
        variant: "destructive",
      });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/reorder`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
      toast({
        title: "Items added to cart",
        description: "Your order items have been added to the cart",
      });
      setLocation("/cart-checkout");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to reorder items",
        variant: "destructive",
      });
    },
  });

  const resendEmailMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("POST", `/api/orders/${orderId}/resend-email`);
    },
    onSuccess: (data: any) => {
      toast({
        title: "Email sent",
        description: data.message || "Order confirmation email has been resent",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to resend confirmation email",
        variant: "destructive",
      });
    },
  });

  const handleDelayPickup = (subscriptionId: string) => {
    const weeksToDelay = selectedWeeksDelay[subscriptionId];
    if (!weeksToDelay) {
      toast({
        title: "Error",
        description: "Please select how many weeks to delay",
        variant: "destructive",
      });
      return;
    }

    updateSubscriptionMutation.mutate({
      subscriptionId,
      updates: { 
        weeksToDelay,
      },
    });
    
    setSelectedWeeksDelay(prev => {
      const updated = { ...prev };
      delete updated[subscriptionId];
      return updated;
    });
  };

  const handleChangeFrequency = (subscriptionId: string) => {
    const newFrequency = selectedFrequency[subscriptionId];
    if (!newFrequency) {
      toast({
        title: "Error",
        description: "Please select a frequency",
        variant: "destructive",
      });
      return;
    }

    updateSubscriptionMutation.mutate({
      subscriptionId,
      updates: { subscriptionFrequency: newFrequency },
    });
    
    setSelectedFrequency(prev => {
      const updated = { ...prev };
      delete updated[subscriptionId];
      return updated;
    });
  };

  const handleMoveToNextWeek = (subscriptionId: string) => {
    updateSubscriptionMutation.mutate({
      subscriptionId,
      updates: { advanceToNextWeek: true },
    });
  };

  const handleAddProduct = () => {
    if (!selectedNewProduct || !addProductDialog.subscriptionId) {
      toast({
        title: "Error",
        description: "Please select a product",
        variant: "destructive",
      });
      return;
    }

    // Check if selected product is multi-flavor and requires flavor selection
    const selectedProduct = retailProducts?.find(p => p.id === selectedNewProduct);
    if (selectedProduct?.productType === 'multi-flavor' && !selectedNewFlavor) {
      toast({
        title: "Error",
        description: "Please select a flavor",
        variant: "destructive",
      });
      return;
    }

    addRetailItemMutation.mutate({
      subscriptionId: addProductDialog.subscriptionId,
      retailProductId: selectedNewProduct,
      selectedFlavorId: selectedNewFlavor || null,
      quantity: selectedNewQuantity,
    });
  };

  const handleRemoveItem = (subscriptionId: string, itemId: string) => {
    removeItemMutation.mutate({ subscriptionId, itemId });
  };

  const handleCancelSubscription = () => {
    if (!cancelDialog.subscriptionId) return;
    cancelSubscriptionMutation.mutate(cancelDialog.subscriptionId);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'fulfilled':
        return 'default';
      case 'ready_for_pickup':
        return 'secondary';
      case 'pending':
        return 'outline';
      case 'cancelled':
        return 'destructive';
      default:
        return 'outline';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'fulfilled':
        return 'Completed';
      case 'ready_for_pickup':
        return 'Ready for Pickup';
      case 'pending':
        return 'Processing';
      case 'cancelled':
        return 'Cancelled';
      default:
        return status;
    }
  };

  const activeSubscriptions = subscriptions?.filter(sub => sub.status === 'active');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }} data-testid="heading-my-account">
              My Account
            </h1>
            <p className="text-muted-foreground">
              Manage your orders and subscriptions
            </p>
          </div>
          <Button
            onClick={() => createBillingPortalMutation.mutate()}
            disabled={createBillingPortalMutation.isPending}
            data-testid="button-manage-payment"
          >
            <CreditCard className="w-4 h-4 mr-2" />
            {createBillingPortalMutation.isPending ? "Opening..." : "Manage Payment Method"}
          </Button>
        </div>

        <Tabs defaultValue="subscriptions" className="w-full" data-testid="tabs-my-account">
          <TabsList className="grid w-full grid-cols-2 max-w-md mb-8">
            <TabsTrigger value="subscriptions" data-testid="tab-subscriptions">
              <Repeat className="w-4 h-4 mr-2" />
              Subscriptions
            </TabsTrigger>
            <TabsTrigger value="orders" data-testid="tab-orders">
              <Package className="w-4 h-4 mr-2" />
              Order History
            </TabsTrigger>
          </TabsList>

          <TabsContent value="subscriptions" data-testid="content-subscriptions">
            {subscriptionsLoading ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {[1, 2].map((i) => (
                  <Card key={i}>
                    <CardHeader>
                      <div className="h-6 bg-muted rounded animate-pulse" />
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                        <div className="h-4 bg-muted rounded w-1/2 animate-pulse" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : activeSubscriptions && activeSubscriptions.length > 0 ? (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {activeSubscriptions.map((subscription) => {
                    const nextDelivery = subscription.nextDeliveryDate 
                      ? new Date(subscription.nextDeliveryDate)
                      : null;

                    return (
                      <Card key={subscription.id} data-testid={`card-subscription-${subscription.id}`}>
                        <CardHeader className="pb-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <CardTitle className="text-xl mb-2">
                                Subscription
                              </CardTitle>
                              <div className="flex gap-2 flex-wrap">
                                <Badge variant="secondary" className="capitalize">
                                  <Repeat className="w-3 h-3 mr-1" />
                                  {subscription.subscriptionFrequency || 'Weekly'}
                                </Badge>
                                <Badge variant="default">
                                  Active
                                </Badge>
                              </div>
                            </div>
                            <Button 
                              variant="ghost" 
                              size="icon"
                              onClick={() => setCancelDialog({ open: true, subscriptionId: subscription.id })}
                              data-testid={`button-cancel-${subscription.id}`}
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-6">
                          {nextDelivery && (
                            <div>
                              <div className="text-sm text-muted-foreground mb-1">Next Pickup</div>
                              <div className="font-semibold" data-testid={`text-next-pickup-${subscription.id}`}>
                                Week of {format(startOfWeek(nextDelivery, { weekStartsOn: 1 }), 'MMMM d, yyyy')}
                              </div>
                            </div>
                          )}

                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <div className="text-sm font-medium">Products</div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setAddProductDialog({ open: true, subscriptionId: subscription.id })}
                                data-testid={`button-add-product-${subscription.id}`}
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                Add Product
                              </Button>
                            </div>
                            <div className="space-y-2">
                              {subscription.items && subscription.items.length > 0 ? (
                                subscription.items.map((item: any) => {
                                  const productInfo = item.product || item.retailProduct;
                                  const flavorInfo = item.flavor;
                                  const retailProduct = retailProducts?.find(rp => rp.id === item.retailProductId);
                                  const isMultiFlavor = retailProduct?.productType === 'multi-flavor';
                                  const availableFlavors = retailProduct?.flavors || [];
                                  
                                  // For single-flavor products, get flavor from retail product
                                  const displayFlavor = flavorInfo || (retailProduct?.flavor);
                                  const displayName = productInfo?.productName || productInfo?.name || 'Product';
                                  const imageUrl = displayFlavor?.imageUrl || productInfo?.imageUrl;
                                  
                                  return (
                                    <div 
                                      key={item.id} 
                                      className="flex flex-col p-3 rounded-md bg-muted/50 gap-2"
                                      data-testid={`item-${item.id}`}
                                    >
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3 flex-1">
                                          {imageUrl && (
                                            <div className="w-12 h-12 rounded-md overflow-hidden flex-shrink-0">
                                              <img 
                                                src={imageUrl} 
                                                alt={displayName}
                                                className="w-full h-full object-cover"
                                              />
                                            </div>
                                          )}
                                          <div className="flex-1">
                                            <div className="font-medium text-sm" data-testid={`text-product-name-${item.id}`}>
                                              {displayName}
                                            </div>
                                            {displayFlavor && (
                                              <div className="text-xs text-muted-foreground" data-testid={`text-flavor-${item.id}`}>
                                                {displayFlavor.name}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        {subscription.items.length > 1 && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => handleRemoveItem(subscription.id, item.id)}
                                            disabled={removeItemMutation.isPending}
                                            data-testid={`button-remove-item-${item.id}`}
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </Button>
                                        )}
                                      </div>
                                      
                                      <div className="flex flex-col gap-2">
                                        {/* Quantity selector */}
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs text-muted-foreground">Quantity:</span>
                                          <Select
                                            value={item.quantity?.toString() || '1'}
                                            onValueChange={(value) => updateQuantityMutation.mutate({
                                              subscriptionId: subscription.id,
                                              itemId: item.id,
                                              quantity: parseInt(value)
                                            })}
                                            disabled={updateQuantityMutation.isPending}
                                          >
                                            <SelectTrigger className="h-8 text-xs w-32" data-testid={`select-quantity-${item.id}`}>
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                              {[1, 2, 3, 4, 5].map((qty) => (
                                                <SelectItem key={qty} value={qty.toString()}>
                                                  {qty} case{qty > 1 ? 's' : ''}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>

                                        {/* Flavor selector for multi-flavor products */}
                                        {isMultiFlavor && availableFlavors.length > 0 && (
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs text-muted-foreground">Flavor:</span>
                                            <Select
                                              value={item.selectedFlavorId || ''}
                                              onValueChange={(value) => updateFlavorMutation.mutate({
                                                subscriptionId: subscription.id,
                                                itemId: item.id,
                                                selectedFlavorId: value
                                              })}
                                              disabled={updateFlavorMutation.isPending}
                                            >
                                              <SelectTrigger className="h-8 text-xs flex-1" data-testid={`select-flavor-${item.id}`}>
                                                <SelectValue placeholder="Select flavor" />
                                              </SelectTrigger>
                                              <SelectContent>
                                                {availableFlavors.map((flavor: any) => (
                                                  <SelectItem key={flavor.id} value={flavor.id}>
                                                    {flavor.name}
                                                  </SelectItem>
                                                ))}
                                              </SelectContent>
                                            </Select>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="text-sm text-muted-foreground text-center py-4">
                                  No products in this subscription
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div>
                              <div className="text-sm font-medium mb-3">Change Frequency</div>
                              <div className="flex gap-2">
                                <Select
                                  value={selectedFrequency[subscription.id] || subscription.subscriptionFrequency || ""}
                                  onValueChange={(value) => setSelectedFrequency(prev => ({ ...prev, [subscription.id]: value }))}
                                >
                                  <SelectTrigger 
                                    className="flex-1"
                                    data-testid={`select-frequency-${subscription.id}`}
                                  >
                                    <SelectValue placeholder="Select frequency" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="weekly" data-testid="option-frequency-weekly">Weekly</SelectItem>
                                    <SelectItem value="bi-weekly" data-testid="option-frequency-bi-weekly">Bi-weekly (every 2 weeks)</SelectItem>
                                    <SelectItem value="every-4-weeks" data-testid="option-frequency-every-4-weeks">Every 4 weeks</SelectItem>
                                    <SelectItem value="every-6-weeks" data-testid="option-frequency-every-6-weeks">Every 6 weeks</SelectItem>
                                    <SelectItem value="every-8-weeks" data-testid="option-frequency-every-8-weeks">Every 8 weeks</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button 
                                  onClick={() => handleChangeFrequency(subscription.id)}
                                  disabled={
                                    !selectedFrequency[subscription.id] || 
                                    selectedFrequency[subscription.id] === subscription.subscriptionFrequency ||
                                    updateSubscriptionMutation.isPending
                                  }
                                  data-testid={`button-change-frequency-${subscription.id}`}
                                >
                                  Update
                                </Button>
                              </div>
                            </div>
                            
                            <div>
                              <div className="text-sm font-medium mb-3">Delay Next Pickup</div>
                              <div className="flex gap-2">
                                <Select
                                  value={selectedWeeksDelay[subscription.id]?.toString() || ""}
                                  onValueChange={(value) => setSelectedWeeksDelay(prev => ({ ...prev, [subscription.id]: parseInt(value) }))}
                                >
                                  <SelectTrigger 
                                    className="flex-1"
                                    data-testid={`select-delay-weeks-${subscription.id}`}
                                  >
                                    <SelectValue placeholder="Select weeks to delay" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="1" data-testid="option-delay-1">1 week</SelectItem>
                                    <SelectItem value="2" data-testid="option-delay-2">2 weeks</SelectItem>
                                    <SelectItem value="3" data-testid="option-delay-3">3 weeks</SelectItem>
                                    <SelectItem value="4" data-testid="option-delay-4">4 weeks</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button 
                                  onClick={() => handleDelayPickup(subscription.id)}
                                  disabled={!selectedWeeksDelay[subscription.id] || updateSubscriptionMutation.isPending}
                                  data-testid={`button-delay-${subscription.id}`}
                                >
                                  Update
                                </Button>
                              </div>
                            </div>

                            <div>
                              <div className="text-sm font-medium mb-3">Move Pickup Earlier</div>
                              <div className="text-xs text-muted-foreground mb-2">
                                Available Monday through Thursday only
                              </div>
                              <Button 
                                className="w-full"
                                variant="outline"
                                onClick={() => handleMoveToNextWeek(subscription.id)}
                                disabled={updateSubscriptionMutation.isPending}
                                data-testid={`button-move-to-next-week-${subscription.id}`}
                              >
                                Move to Next Week
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
                {activeSubscriptions.length > 0 && (
                  <div className="mt-8">
                    <h2 className="text-2xl font-bold mb-4">Pickup Information</h2>
                    <PickupInfo />
                  </div>
                )}
              </>
            ) : (
              <Card>
                <CardContent className="py-20 text-center">
                  <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-2xl font-semibold mb-2">No Active Subscriptions</h3>
                  <p className="text-muted-foreground mb-6">
                    You don't have any active subscriptions yet
                  </p>
                  <Button asChild data-testid="button-browse-products">
                    <a href="/shop">Browse Products</a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="orders" data-testid="content-orders">
            {ordersLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="p-6">
                      <div className="animate-pulse space-y-3">
                        <div className="h-4 bg-muted rounded w-1/4"></div>
                        <div className="h-4 bg-muted rounded w-1/2"></div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : orders && orders.length > 0 ? (
              <div className="space-y-4">
                {orders.map(({ order, items }) => (
                  <Card key={order.id} data-testid={`card-order-${order.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                          <CardTitle className="text-lg" data-testid={`text-order-number-${order.id}`}>
                            Order #{order.orderNumber}
                          </CardTitle>
                          <div className="flex items-center gap-2 mt-2 text-sm text-muted-foreground">
                            <Calendar className="h-4 w-4" />
                            <span data-testid={`text-order-date-${order.id}`}>
                              {format(new Date(order.orderDate), 'MMMM d, yyyy')}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={getStatusBadgeVariant(order.status)} data-testid={`badge-status-${order.id}`}>
                            {getStatusLabel(order.status)}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => resendEmailMutation.mutate(order.id)}
                            disabled={resendEmailMutation.isPending}
                            data-testid={`button-resend-email-${order.id}`}
                          >
                            <Mail className="h-4 w-4 mr-1" />
                            Resend Email
                          </Button>
                          {order.status !== 'cancelled' && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => reorderMutation.mutate(order.id)}
                              disabled={reorderMutation.isPending}
                              data-testid={`button-reorder-${order.id}`}
                            >
                              <ShoppingCart className="w-4 h-4 mr-2" />
                              Reorder
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        {items.map((item) => (
                          <div 
                            key={item.id} 
                            className="flex items-center justify-between py-2 border-b last:border-b-0"
                            data-testid={`item-${item.id}`}
                          >
                            <div className="flex items-center gap-3">
                              <Package className="h-5 w-5 text-muted-foreground" />
                              <div>
                                <p className="font-medium" data-testid={`text-product-name-${item.id}`}>
                                  {item.product?.name || 'Product'}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Quantity: {item.quantity}
                                </p>
                              </div>
                            </div>
                            <p className="font-medium" data-testid={`text-item-price-${item.id}`}>
                              ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                            </p>
                          </div>
                        ))}
                      </div>

                      <div className="border-t pt-4 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Subtotal</span>
                          <span data-testid={`text-subtotal-${order.id}`}>
                            ${Number(order.subtotal).toFixed(2)}
                          </span>
                        </div>
                        {Number(order.taxAmount) > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Sales Tax</span>
                            <span data-testid={`text-tax-${order.id}`}>
                              ${Number(order.taxAmount).toFixed(2)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold text-lg border-t pt-2">
                          <span>Total</span>
                          <span data-testid={`text-total-${order.id}`}>
                            ${Number(order.totalAmount).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {order.pickupDate && (
                        <div className="bg-muted/50 p-3 rounded-md">
                          <p className="text-sm font-medium">Pickup Date</p>
                          <p className="text-sm text-muted-foreground" data-testid={`text-pickup-date-${order.id}`}>
                            {format(new Date(order.pickupDate), 'EEEE, MMMM d, yyyy')}
                          </p>
                        </div>
                      )}

                      {order.isSubscriptionOrder && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Badge variant="outline" data-testid={`badge-subscription-order-${order.id}`}>
                            <Package className="h-3 w-3 mr-1" />
                            Subscription Order
                          </Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2" data-testid="text-no-orders">No orders yet</h3>
                  <p className="text-muted-foreground mb-4">
                    You haven't placed any orders yet. Start shopping to see your orders here.
                  </p>
                  <Button asChild data-testid="button-start-shopping">
                    <a href="/shop">Start Shopping</a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={addProductDialog.open} onOpenChange={(open) => {
        if (!open) {
          setAddProductDialog({ open: false, subscriptionId: null });
          setSelectedNewProduct("");
          setSelectedNewQuantity(1);
          setSelectedNewFlavor("");
        }
      }}>
        <DialogContent data-testid="dialog-add-product">
          <DialogHeader>
            <DialogTitle>Add Product to Subscription</DialogTitle>
            <DialogDescription>
              Select a product and quantity to add to your subscription
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium mb-2 block">Product</label>
              <Select 
                value={selectedNewProduct} 
                onValueChange={(value) => {
                  setSelectedNewProduct(value);
                  setSelectedNewFlavor(""); // Reset flavor when product changes
                }}
              >
                <SelectTrigger data-testid="select-new-product">
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {retailProducts?.map((product) => (
                    <SelectItem key={product.id} value={product.id} data-testid={`option-new-product-${product.id}`}>
                      {product.productName || product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            {/* Show flavor selector for multi-flavor products */}
            {selectedNewProduct && retailProducts?.find(p => p.id === selectedNewProduct)?.productType === 'multi-flavor' && (
              <div>
                <label className="text-sm font-medium mb-2 block">Flavor</label>
                <Select value={selectedNewFlavor} onValueChange={setSelectedNewFlavor}>
                  <SelectTrigger data-testid="select-new-flavor">
                    <SelectValue placeholder="Select a flavor" />
                  </SelectTrigger>
                  <SelectContent>
                    {retailProducts?.find(p => p.id === selectedNewProduct)?.flavors?.map((flavor: any) => (
                      <SelectItem key={flavor.id} value={flavor.id} data-testid={`option-new-flavor-${flavor.id}`}>
                        {flavor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            
            <div>
              <label className="text-sm font-medium mb-2 block">Quantity (cases)</label>
              <Select 
                value={selectedNewQuantity.toString()} 
                onValueChange={(value) => setSelectedNewQuantity(parseInt(value))}
              >
                <SelectTrigger data-testid="select-new-quantity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((qty) => (
                    <SelectItem key={qty} value={qty.toString()} data-testid={`option-quantity-${qty}`}>
                      {qty} case{qty > 1 ? 's' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setAddProductDialog({ open: false, subscriptionId: null });
                setSelectedNewProduct("");
                setSelectedNewQuantity(1);
                setSelectedNewFlavor("");
              }}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddProduct}
              disabled={!selectedNewProduct || addRetailItemMutation.isPending}
              data-testid="button-confirm-add"
            >
              Add Product
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialog.open} onOpenChange={(open) => {
        if (!open) setCancelDialog({ open: false, subscriptionId: null });
      }}>
        <DialogContent data-testid="dialog-cancel-subscription">
          <DialogHeader>
            <DialogTitle>Cancel Subscription</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel this subscription? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setCancelDialog({ open: false, subscriptionId: null })}
              data-testid="button-cancel-dialog-no"
            >
              No, keep it
            </Button>
            <Button 
              variant="destructive"
              onClick={handleCancelSubscription}
              disabled={cancelSubscriptionMutation.isPending}
              data-testid="button-cancel-dialog-yes"
            >
              Yes, cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
