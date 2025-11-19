import { useQuery, useMutation } from "@tanstack/react-query";
import { RetailOrder, RetailOrderItem, Product } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Package, Calendar, ShoppingCart } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Navbar } from "@/components/layout/navbar";

type OrderWithDetails = {
  order: RetailOrder;
  items: Array<RetailOrderItem & { product: Product }>;
};

export default function OrderHistory() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  
  const { data: orders, isLoading } = useQuery<OrderWithDetails[]>({
    queryKey: ["/api/my-orders"],
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

  return (
    <>
      <Navbar />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2" data-testid="heading-order-history">Order History</h1>
          <p className="text-muted-foreground">View all your past orders and their status</p>
        </div>

        {isLoading ? (
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
                      <Package className="h-4 w-4" />
                      <span>Subscription Order</span>
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
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
