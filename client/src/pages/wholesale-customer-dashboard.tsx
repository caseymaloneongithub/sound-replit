import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, FileText, MapPin, Calendar } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import type { WholesaleCustomer } from "@shared/schema";

type WholesaleOrder = {
  id: string;
  invoiceNumber: string;
  orderDate: string;
  deliveryDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    productName: string;
  }>;
};

export default function WholesaleCustomerDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: customer, isLoading: customerLoading } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale-customer/orders"],
  });

  const isLoading = customerLoading || ordersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const pendingOrders = orders?.filter(o => o.status === 'pending') || [];
  const processingOrders = orders?.filter(o => o.status === 'processing') || [];
  const shippedOrders = orders?.filter(o => o.status === 'shipped') || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              {customer?.businessName ? `${customer.businessName} - Wholesale Dashboard` : 'Wholesale Dashboard'}
            </h1>
            <p className="text-muted-foreground mt-1">Manage your wholesale orders and view history</p>
          </div>
          <Button 
            onClick={() => setLocation('/wholesale-customer/place-order')}
            data-testid="button-place-order"
          >
            <Package className="mr-2 h-4 w-4" />
            Place New Order
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-pending-count">{pendingOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processing</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-processing-count">{processingOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Shipped</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-shipped-count">{shippedOrders.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {!orders || orders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orders yet</p>
                <p className="text-sm mt-2">Place your first order to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                    data-testid={`card-order-${order.id}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium" data-testid={`text-invoice-${order.id}`}>
                          {order.invoiceNumber}
                        </p>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            order.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                            order.status === 'processing' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                            order.status === 'shipped' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                            'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          }`}
                          data-testid={`status-${order.id}`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Ordered: {format(new Date(order.orderDate), 'MMM dd, yyyy')}
                      </p>
                      {order.deliveryDate && (
                        <p className="text-sm text-muted-foreground">
                          Delivery: {format(new Date(order.deliveryDate), 'MMM dd, yyyy')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold" data-testid={`text-total-${order.id}`}>
                          ${parseFloat(order.totalAmount).toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/wholesale/invoice/${order.id}`, '_blank')}
                        data-testid={`button-view-invoice-${order.id}`}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        View Invoice
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
