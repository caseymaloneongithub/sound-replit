import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Subscription, Product } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Repeat, Plus, Trash2, X, CreditCard } from "lucide-react";
import { format, addWeeks } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

export default function MySubscriptions() {
  const { toast } = useToast();
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

  const { data: subscriptions, isLoading: subscriptionsLoading } = useQuery<SubscriptionWithItems[]>({
    queryKey: ["/api/my-subscriptions"],
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
      // Open Stripe billing portal in new tab
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

    // Send declarative adjustment - server computes actual dates
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

    addItemMutation.mutate({
      subscriptionId: addProductDialog.subscriptionId,
      productId: selectedNewProduct,
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

  const activeSubscriptions = subscriptions?.filter(sub => sub.status === 'active');

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              My Subscriptions
            </h1>
            <p className="text-muted-foreground">
              Manage your kombucha subscriptions
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
                          {format(nextDelivery, 'MMMM d, yyyy')}
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
                            // Handle both old format (product) and new format (retailProduct + flavor)
                            const productInfo = item.product || item.retailProduct;
                            const flavorInfo = item.flavor;
                            const displayName = flavorInfo 
                              ? `${productInfo?.name || 'Product'}`
                              : productInfo?.name || 'Product';
                            const imageUrl = flavorInfo?.imageUrl || productInfo?.imageUrl;
                            
                            // Find the retail product to get available flavors
                            const retailProduct = retailProducts?.find(rp => rp.id === item.retailProductId);
                            const isMultiFlavor = retailProduct?.productType === 'multi-flavor';
                            const availableFlavors = retailProduct?.flavors || [];
                            
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
                                      <div className="text-xs text-muted-foreground">
                                        Quantity: {item.quantity} case{item.quantity > 1 ? 's' : ''}
                                      </div>
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
                                
                                {/* Flavor selector for retail subscriptions with flavors */}
                                {item.selectedFlavorId !== undefined && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-muted-foreground">Flavor:</span>
                                    {isMultiFlavor && availableFlavors.length > 0 ? (
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
                                    ) : (
                                      <span className="text-xs font-medium">{flavorInfo?.name || 'No flavor selected'}</span>
                                    )}
                                  </div>
                                )}
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
        ) : (
          <Card>
            <CardContent className="py-20 text-center">
              <Package className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-2xl font-semibold mb-2">No Active Subscriptions</h3>
              <p className="text-muted-foreground mb-6">
                You don't have any active subscriptions yet
              </p>
              <Button asChild>
                <a href="/shop">Browse Products</a>
              </Button>
            </CardContent>
          </Card>
        )}

        {activeSubscriptions && activeSubscriptions.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Pickup Information</h2>
            <PickupInfo />
          </div>
        )}
      </div>

      <Dialog open={addProductDialog.open} onOpenChange={(open) => {
        if (!open) {
          setAddProductDialog({ open: false, subscriptionId: null });
          setSelectedNewProduct("");
          setSelectedNewQuantity(1);
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
              <Select value={selectedNewProduct} onValueChange={setSelectedNewProduct}>
                <SelectTrigger data-testid="select-new-product">
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((product) => (
                    <SelectItem key={product.id} value={product.id} data-testid={`option-new-product-${product.id}`}>
                      {product.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              }}
              data-testid="button-cancel-add"
            >
              Cancel
            </Button>
            <Button 
              onClick={handleAddProduct}
              disabled={!selectedNewProduct || addItemMutation.isPending}
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
