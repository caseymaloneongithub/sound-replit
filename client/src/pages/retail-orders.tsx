import { useQuery, useMutation } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Loader2, Package } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RetailOrder } from "@shared/schema";

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-yellow-500';
    case 'ready_for_pickup': return 'bg-blue-500';
    case 'fulfilled': return 'bg-green-500';
    case 'cancelled': return 'bg-red-500';
    default: return 'bg-gray-500';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'ready_for_pickup': return 'Ready for Pickup';
    case 'fulfilled': return 'Fulfilled';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

export default function RetailOrders() {
  const { toast } = useToast();

  const { data: orders = [], isLoading } = useQuery<RetailOrder[]>({
    queryKey: ['/api/retail/orders'],
  });

  const updateOrderStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      return await apiRequest('PATCH', `/api/retail/orders/${orderId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/orders'] });
      toast({
        title: "Order updated",
        description: "Retail order status has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update order status",
        variant: "destructive",
      });
    },
  });

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Retail Orders
          </h1>
          <p className="text-muted-foreground">
            View and manage retail customer orders
          </p>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading orders...</span>
          </div>
        ) : orders.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">No retail orders found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <Card key={order.id} data-testid={`card-retail-order-${order.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <CardTitle className="text-lg mb-1">
                        Order #{order.orderNumber}
                      </CardTitle>
                      <CardDescription className="space-y-1">
                        <div><strong>Customer:</strong> {order.customerName}</div>
                        <div><strong>Email:</strong> {order.customerEmail}</div>
                        <div><strong>Phone:</strong> {order.customerPhone}</div>
                        <div><strong>Order Date:</strong> {new Date(order.orderDate).toLocaleDateString()}</div>
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold mb-2">
                        ${Number(order.totalAmount).toFixed(2)}
                      </div>
                      <div className="text-sm text-muted-foreground mb-2">
                        Subtotal: ${Number(order.subtotal).toFixed(2)}
                        <br />
                        Tax: ${Number(order.taxAmount).toFixed(2)}
                      </div>
                      <Select
                        value={order.status}
                        onValueChange={(status) => 
                          updateOrderStatusMutation.mutate({ orderId: order.id, status })
                        }
                        disabled={updateOrderStatusMutation.isPending || order.status === 'fulfilled' || order.status === 'cancelled'}
                      >
                        <SelectTrigger className="w-[180px]" data-testid={`select-retail-order-status-${order.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending" data-testid="status-pending">Pending</SelectItem>
                          <SelectItem value="ready_for_pickup" data-testid="status-ready-for-pickup">Ready for Pickup</SelectItem>
                          <SelectItem value="fulfilled" data-testid="status-fulfilled">Fulfilled</SelectItem>
                          <SelectItem value="cancelled" data-testid="status-cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      {order.fulfilledAt && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Fulfilled: {new Date(order.fulfilledAt).toLocaleString()}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
