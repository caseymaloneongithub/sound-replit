import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Subscription, Product } from "@shared/schema";
import { Navbar } from "@/components/layout/navbar";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CalendarIcon, Package, Repeat } from "lucide-react";
import { format, addDays, addWeeks } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type SubscriptionWithProduct = Subscription & {
  product?: Product;
};

export default function MySubscriptions() {
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState<Record<string, Date>>({});
  const [selectedProduct, setSelectedProduct] = useState<Record<string, string>>({});

  const { data: subscriptions, isLoading: subscriptionsLoading } = useQuery<SubscriptionWithProduct[]>({
    queryKey: ["/api/my-subscriptions"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
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

  const handleDelayDelivery = (subscriptionId: string) => {
    const newDate = selectedDate[subscriptionId];
    if (!newDate) {
      toast({
        title: "Error",
        description: "Please select a new delivery date",
        variant: "destructive",
      });
      return;
    }

    updateSubscriptionMutation.mutate({
      subscriptionId,
      updates: { nextDeliveryDate: newDate.toISOString() },
    });
  };

  const handleChangeProduct = (subscriptionId: string) => {
    const newProductId = selectedProduct[subscriptionId];
    if (!newProductId) {
      toast({
        title: "Error",
        description: "Please select a product",
        variant: "destructive",
      });
      return;
    }

    updateSubscriptionMutation.mutate({
      subscriptionId,
      updates: { productId: newProductId },
    });
  };

  // Enrich subscriptions with product data
  const enrichedSubscriptions = subscriptions?.map(sub => {
    const product = products?.find(p => p.id === sub.productId);
    return { ...sub, product };
  });

  const activeSubscriptions = enrichedSubscriptions?.filter(sub => sub.status === 'active');

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            My Subscriptions
          </h1>
          <p className="text-muted-foreground">
            Manage your kombucha subscriptions
          </p>
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
                      <div>
                        <CardTitle className="text-xl mb-2">
                          {subscription.product?.name || 'Product'}
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
                      {subscription.product?.imageUrl && (
                        <div className="w-20 h-20 rounded-md overflow-hidden flex-shrink-0">
                          <img 
                            src={subscription.product.imageUrl} 
                            alt={subscription.product.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {nextDelivery && (
                      <div>
                        <div className="text-sm text-muted-foreground mb-1">Next Delivery</div>
                        <div className="font-semibold">{format(nextDelivery, 'MMMM d, yyyy')}</div>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-medium mb-3">Delay Next Delivery</div>
                        <div className="flex gap-2">
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button 
                                variant="outline" 
                                className="flex-1 justify-start gap-2"
                                data-testid={`button-select-date-${subscription.id}`}
                              >
                                <CalendarIcon className="w-4 h-4" />
                                {selectedDate[subscription.id] 
                                  ? format(selectedDate[subscription.id], 'MMM d, yyyy')
                                  : 'Select new date'
                                }
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                              <Calendar
                                mode="single"
                                selected={selectedDate[subscription.id]}
                                onSelect={(date) => date && setSelectedDate(prev => ({ ...prev, [subscription.id]: date }))}
                                disabled={(date) => date < addDays(new Date(), 1)}
                                initialFocus
                              />
                            </PopoverContent>
                          </Popover>
                          <Button 
                            onClick={() => handleDelayDelivery(subscription.id)}
                            disabled={!selectedDate[subscription.id] || updateSubscriptionMutation.isPending}
                            data-testid={`button-delay-${subscription.id}`}
                          >
                            Update
                          </Button>
                        </div>
                      </div>

                      <div>
                        <div className="text-sm font-medium mb-3">Change Product</div>
                        <div className="flex gap-2">
                          <Select
                            value={selectedProduct[subscription.id] || subscription.productId || undefined}
                            onValueChange={(value) => setSelectedProduct(prev => ({ ...prev, [subscription.id]: value }))}
                          >
                            <SelectTrigger 
                              className="flex-1"
                              data-testid={`select-product-${subscription.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {products?.map((product) => (
                                <SelectItem 
                                  key={product.id} 
                                  value={product.id}
                                  data-testid={`option-product-${product.id}`}
                                >
                                  {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button 
                            onClick={() => handleChangeProduct(subscription.id)}
                            disabled={
                              !selectedProduct[subscription.id] || 
                              selectedProduct[subscription.id] === subscription.productId ||
                              updateSubscriptionMutation.isPending
                            }
                            data-testid={`button-change-product-${subscription.id}`}
                          >
                            Update
                          </Button>
                        </div>
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
      </div>
    </div>
  );
}
