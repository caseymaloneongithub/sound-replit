import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Landmark, RotateCcw, ChevronDown, ChevronRight } from "lucide-react";
import { format, differenceInDays, isPast } from "date-fns";
import type { WholesaleCustomer } from "@shared/schema";
import { WholesaleCustomerLayout } from "@/components/wholesale/wholesale-customer-layout";
import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { saveWholesaleCart } from "@/lib/wholesale-cart";
import { PICKUP_POLICY } from "@shared/pickup-policy";

type WholesaleOrder = {
  id: string;
  invoiceNumber: string;
  orderDate: string;
  deliveryDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  locationId: string | null;
  fulfillmentMethod: string;
  dueDate: string | null;
  paidAt: string | null;
  paymentInitiatedAt: string | null;
  paymentFailedAt: string | null;
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
    productId: string | null;
    unitTypeId: string | null;
    flavorId: string | null;
    unitTypeName: string | null;
    flavorName: string | null;
    quantity: number;
    unitPrice: string;
    productName: string | null;
  }>;
};

/** "Case of 12 Bottles — Ginger", falling back to the legacy product name. */
function itemLabel(item: WholesaleOrder["items"][number]): string {
  const parts = [item.unitTypeName, item.flavorName].filter(Boolean);
  if (parts.length > 0) return parts.join(" — ");
  return item.productName || "Item";
}

function PaymentStatusBadge({ order }: { order: WholesaleOrder }) {
  if (order.paidAt) {
    return (
      <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 hover:bg-green-100 dark:hover:bg-green-900">
        Paid
      </Badge>
    );
  }

  // A bank transfer takes days to clear. Without saying so, a customer who has already
  // paid still sees "Due in 12 days" and may well pay a second time.
  if (order.paymentInitiatedAt) {
    return (
      <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-100 dark:hover:bg-blue-900">
        Payment processing
      </Badge>
    );
  }

  if (order.paymentFailedAt) {
    return (
      <Badge variant="destructive">
        Payment didn't clear
      </Badge>
    );
  }

  if (!order.dueDate) {
    return null;
  }

  const dueDate = new Date(order.dueDate);
  const today = new Date();
  const daysUntilDue = differenceInDays(dueDate, today);

  if (isPast(dueDate)) {
    return (
      <Badge variant="destructive">
        Overdue
      </Badge>
    );
  }

  return (
    <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 hover:bg-yellow-100 dark:hover:bg-yellow-900">
      Due in {daysUntilDue} {daysUntilDue === 1 ? 'day' : 'days'}
    </Badge>
  );
}

export default function WholesaleCustomerOrders() {
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: customer, isLoading: customerLoading } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  /**
   * Rebuild a cart from a past order and hand off to the order form. Rebuilding a
   * standing weekly order by hand was ~30 interactions from a cold form; this is two
   * clicks. Items we no longer carry are pruned by the order form, which holds the
   * live catalogue.
   */
  const reorder = (order: WholesaleOrder) => {
    const items = order.items
      .filter((i) => i.unitTypeId && i.flavorId)
      .map((i) => ({ unitTypeId: i.unitTypeId!, flavorId: i.flavorId!, quantity: i.quantity }));

    if (items.length === 0) {
      toast({
        title: "Can't reorder this one",
        description: "This order predates our current product list. Please build it on the order form.",
        variant: "destructive",
      });
      return;
    }

    saveWholesaleCart(customer?.id, items);
    toast({
      title: `${items.length} ${items.length === 1 ? "item" : "items"} added to your cart`,
      description: `Copied from ${order.invoiceNumber}. Adjust quantities before you submit.`,
    });
    setLocation("/wholesale-customer/place-order");
  };

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
      <div className="py-8 space-y-8">
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
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-pending-count">{pendingOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Packaged</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-packaged-count">{packagedOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
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
                <p>No orders yet</p>
                <p className="text-sm mt-2">Place your first order to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="p-4 border rounded-md hover-elevate"
                    data-testid={`card-order-${order.id}`}
                  >
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
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
                        <PaymentStatusBadge order={order} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Ordered: {format(new Date(order.orderDate), 'MMM dd, yyyy')}
                      </p>
                      {order.deliveryDate && (
                        <p className="text-sm text-muted-foreground">
                          Delivery: {format(new Date(order.deliveryDate), 'MMM dd, yyyy')}
                        </p>
                      )}
                      {/* Without this a pickup order shows no destination at all, which
                          reads as missing data rather than a deliberate choice. */}
                      {order.fulfillmentMethod === 'pickup' && (
                        <div className="flex items-start gap-2 mt-2 p-2 bg-muted/50 rounded">
                          <div className="flex-1 text-sm">
                            <div className="font-medium text-foreground">Pickup at the brewery</div>
                            <div className="text-muted-foreground">{PICKUP_POLICY.address}</div>
                            <div className="text-muted-foreground">Mon&ndash;Thu, {PICKUP_POLICY.timeWindow}</div>
                          </div>
                        </div>
                      )}
                      {order.fulfillmentMethod !== 'pickup' && order.location && (
                        <div className="flex items-start gap-2 mt-2 p-2 bg-muted/50 rounded">
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
                        <button
                          type="button"
                          onClick={() => setExpandedOrderId(expandedOrderId === order.id ? null : order.id)}
                          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                          aria-expanded={expandedOrderId === order.id}
                          data-testid={`button-toggle-items-${order.id}`}
                        >
                          {expandedOrderId === order.id
                            ? <ChevronDown className="h-3 w-3" />
                            : <ChevronRight className="h-3 w-3" />}
                          {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => reorder(order)}
                          data-testid={`button-reorder-${order.id}`}
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reorder
                        </Button>
                        {(customer?.allowOnlinePayment || (customer as any)?.allowCardPayment) && !order.paidAt && !order.paymentInitiatedAt && (
                          <Button
                            size="sm"
                            onClick={() => window.location.href = `/wholesale-customer/invoice/${order.id}`}
                            data-testid={`button-pay-now-${order.id}`}
                          >
                            <Landmark className="h-4 w-4 mr-2" />
                            Pay online
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(`/wholesale-customer/invoice/${order.id}`, '_blank')}
                          data-testid={`button-view-invoice-${order.id}`}
                        >
                          <FileText className="h-4 w-4 mr-2" />
                          View Invoice
                        </Button>
                      </div>
                    </div>
                    </div>

                    {expandedOrderId === order.id && (
                      <div className="mt-4 pt-4 border-t" data-testid={`items-${order.id}`}>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-muted-foreground text-left">
                              <th className="font-medium pb-1">Item</th>
                              <th className="font-medium pb-1 text-right">Qty</th>
                              <th className="font-medium pb-1 text-right">Unit</th>
                              <th className="font-medium pb-1 text-right">Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {order.items.map((item) => (
                              <tr key={item.id}>
                                <td className="py-1">{itemLabel(item)}</td>
                                <td className="py-1 text-right">{item.quantity}</td>
                                <td className="py-1 text-right">${parseFloat(item.unitPrice).toFixed(2)}</td>
                                <td className="py-1 text-right">
                                  ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {order.notes && (
                          <p className="text-sm text-muted-foreground mt-3">
                            <span className="font-medium text-foreground">Your notes: </span>
                            {order.notes}
                          </p>
                        )}
                      </div>
                    )}
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
