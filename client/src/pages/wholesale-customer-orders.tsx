import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, FileText, MapPin, Calendar } from "lucide-react";
import { format } from "date-fns";
import type { WholesaleCustomer } from "@shared/schema";
import { WholesaleCustomerLayout } from "@/components/wholesale/wholesale-customer-layout";

type WholesaleOrder = {
  id: string;
  invoiceNumber: string;
  orderDate: string;
  deliveryDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  locationId: string | null;
  location?: {
    locationName: string;
    address: string;
    city: string;
    state: string;
    zipCode: string;
    contactName?: string;
    contactPhone?: string;
  };
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    productName: string;
  }>;
};

export default function WholesaleCustomerOrders() {
  const { data: customer, isLoading: customerLoading } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale-customer/orders"],
  });

  const isLoading = customerLoading || ordersLoading;

  if (isLoading) {
    return (
      <WholesaleCustomerLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </WholesaleCustomerLayout>
    );
  }

  const pendingOrders = orders?.filter(o => o.status === 'pending') || [];
  const packagedOrders = orders?.filter(o => o.status === 'packaged') || [];
  const deliveredOrders = orders?.filter(o => o.status === 'delivered') || [];

  return (
    <WholesaleCustomerLayout>
      <div className="container mx-auto py-8 space-y-8">
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">
            Order History
          </h1>
          <p className="text-muted-foreground mt-1">
            {customer?.businessName && `${customer.businessName} - `}View and track your orders
          </p>
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
              <CardTitle className="text-sm font-medium">Packaged</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-packaged-count">{packagedOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-delivered-count">{deliveredOrders.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Orders</CardTitle>
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
                            order.status === 'packaged' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
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
                      {order.location && (
                        <div className="flex items-start gap-2 mt-2 p-2 bg-muted/50 rounded">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                          <div className="flex-1 text-sm">
                            <div className="font-medium text-foreground">{order.location.locationName}</div>
                            <div className="text-muted-foreground">
                              {order.location.address}
                            </div>
                            <div className="text-muted-foreground">
                              {order.location.city}, {order.location.state} {order.location.zipCode}
                            </div>
                            {order.location.contactName && (
                              <div className="text-muted-foreground mt-1">
                                Contact: {order.location.contactName}
                                {order.location.contactPhone && ` • ${order.location.contactPhone}`}
                              </div>
                            )}
                          </div>
                        </div>
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
    </WholesaleCustomerLayout>
  );
}
