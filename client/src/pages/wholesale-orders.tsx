import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, WholesaleOrderItem, Product } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { ShoppingCart, Eye, CalendarIcon, FileText, ArrowUpDown, Loader2 } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function getStatusColor(status: string): string {
  switch (status) {
    case 'pending': return 'bg-yellow-500';
    case 'packaged': return 'bg-blue-500';
    case 'delivered': return 'bg-green-500';
    default: return 'bg-gray-500';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'packaged': return 'Packaged';
    case 'delivered': return 'Delivered';
    default: return status;
  }
}

export default function WholesaleOrders() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [deliveryDate, setDeliveryDate] = useState<Date | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('pending');
  const [sortOrders, setSortOrders] = useState<Record<string, 'asc' | 'desc'>>({
    pending: 'asc',      // oldest to newest by default
    packaged: 'desc',
    delivered: 'desc',
  });
  const { toast } = useToast();

  const { data: orders = [], isLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/orders"],
  });
  
  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: orderItems = [] } = useQuery<WholesaleOrderItem[]>({
    queryKey: ["/api/wholesale/orders", selectedOrderId, "items"],
    enabled: !!selectedOrderId,
  });

  const selectedOrder = orders?.find(o => o.id === selectedOrderId);
  const selectedCustomer = customers?.find(c => c.id === selectedOrder?.customerId);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      return await apiRequest("PATCH", `/api/wholesale/orders/${orderId}`, { status });
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Order status has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update order status",
        variant: "destructive",
      });
    },
  });

  const updateDeliveryDateMutation = useMutation({
    mutationFn: async (date: Date | null) => {
      return await apiRequest("PATCH", `/api/wholesale/orders/${selectedOrderId}`, { 
        deliveryDate: date ? date.toISOString() : null 
      });
    },
    onSuccess: () => {
      toast({
        title: "Delivery Date Updated",
        description: "Order delivery date has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update delivery date",
        variant: "destructive",
      });
    },
  });

  const toggleSort = (status: string) => {
    setSortOrders(prev => ({
      ...prev,
      [status]: prev[status] === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getFilteredAndSortedOrders = (status: string) => {
    const filtered = orders.filter(order => order.status === status);
    const sortOrder = sortOrders[status] || 'desc';
    
    return filtered.sort((a, b) => {
      const dateA = new Date(a.orderDate).getTime();
      const dateB = new Date(b.orderDate).getTime();
      return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });
  };

  const renderOrdersList = (status: string) => {
    const filteredOrders = getFilteredAndSortedOrders(status);
    const sortOrder = sortOrders[status] || 'desc';

    if (filteredOrders.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No {getStatusLabel(status).toLowerCase()} orders found</p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => toggleSort(status)}
            data-testid={`button-sort-${status}`}
          >
            <ArrowUpDown className="w-4 h-4 mr-2" />
            {sortOrder === 'asc' ? 'Oldest to Newest' : 'Newest to Oldest'}
          </Button>
        </div>
        {filteredOrders.map((order) => {
          const customer = customers?.find(c => c.id === order.customerId);
          return (
            <Card key={order.id} data-testid={`card-wholesale-order-${order.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-[200px]">
                    <CardTitle className="text-lg mb-1">
                      {customer?.businessName || 'Unknown Customer'}
                    </CardTitle>
                    <CardDescription className="space-y-1">
                      <div><strong>Invoice:</strong> {order.invoiceNumber}</div>
                      <div><strong>Contact:</strong> {customer?.contactName}</div>
                      <div><strong>Email:</strong> {customer?.email}</div>
                      <div><strong>Phone:</strong> {customer?.phone}</div>
                      <div><strong>Order Date:</strong> {new Date(order.orderDate).toLocaleDateString()}</div>
                      {order.deliveryDate && (
                        <div><strong>Delivery Date:</strong> {new Date(order.deliveryDate).toLocaleDateString()}</div>
                      )}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold mb-2">
                      ${Number(order.totalAmount).toFixed(2)}
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end items-center">
                      <Select
                        value={order.status}
                        onValueChange={(newStatus) => 
                          updateStatusMutation.mutate({ orderId: order.id, status: newStatus })
                        }
                        disabled={updateStatusMutation.isPending}
                      >
                        <SelectTrigger className="w-[150px]" data-testid={`select-wholesale-order-status-${order.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending" data-testid="status-pending">Pending</SelectItem>
                          <SelectItem value="packaged" data-testid="status-packaged">Packaged</SelectItem>
                          <SelectItem value="delivered" data-testid="status-delivered">Delivered</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => window.open(`/wholesale/invoice/${order.id}`, '_blank')}
                        data-testid={`button-invoice-${order.id}`}
                        title="View Invoice"
                      >
                        <FileText className="w-4 h-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => {
                          setSelectedOrderId(order.id);
                          setDeliveryDate(order.deliveryDate ? new Date(order.deliveryDate) : undefined);
                        }}
                        data-testid={`button-view-${order.id}`}
                        title="View Details"
                      >
                        <Eye className="w-4 h-4" />
                      </Button>
                    </div>
                    {order.fulfilledAt && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Fulfilled: {new Date(order.fulfilledAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                {order.notes && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-sm text-muted-foreground italic">{order.notes}</p>
                  </div>
                )}
              </CardHeader>
            </Card>
          );
        })}
      </div>
    );
  };

  const orderCounts = {
    pending: orders.filter(o => o.status === 'pending').length,
    packaged: orders.filter(o => o.status === 'packaged').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Wholesale Orders
          </h1>
          <p className="text-muted-foreground">
            Manage and track wholesale customer orders
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
              <p className="text-muted-foreground">No wholesale orders found</p>
            </CardContent>
          </Card>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-wholesale-orders">
            <TabsList className="mb-6">
              <TabsTrigger value="pending" data-testid="tab-pending">
                Pending
                {orderCounts.pending > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="packaged" data-testid="tab-packaged">
                Packaged
                {orderCounts.packaged > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.packaged}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="delivered" data-testid="tab-delivered">
                Delivered
                {orderCounts.delivered > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.delivered}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              {renderOrdersList('pending')}
            </TabsContent>
            <TabsContent value="packaged">
              {renderOrdersList('packaged')}
            </TabsContent>
            <TabsContent value="delivered">
              {renderOrdersList('delivered')}
            </TabsContent>
          </Tabs>
        )}

        <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'var(--font-heading)' }}>Order Details</DialogTitle>
            <DialogDescription>
              Invoice #{selectedOrder?.invoiceNumber} • {selectedOrder && new Date(selectedOrder.orderDate).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Customer</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-semibold">{selectedCustomer?.businessName}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer?.contactName}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer?.email}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer?.phone}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Delivery Date</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {selectedOrder.deliveryDate && (
                      <p className="text-sm text-muted-foreground">
                        {format(new Date(selectedOrder.deliveryDate), 'PPP')}
                      </p>
                    )}
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                          data-testid="button-delivery-date"
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {deliveryDate ? format(deliveryDate, "PPP") : "Set delivery date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={deliveryDate}
                          onSelect={(date) => {
                            setDeliveryDate(date);
                            if (date) {
                              updateDeliveryDateMutation.mutate(date);
                            }
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    {selectedOrder.deliveryDate && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => {
                          setDeliveryDate(undefined);
                          updateDeliveryDateMutation.mutate(null);
                        }}
                        data-testid="button-clear-delivery-date"
                      >
                        Clear Date
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </div>

              {selectedOrder.notes && (
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Notes</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm">{selectedOrder.notes}</p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Order Items</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {orderItems.map((item) => {
                      const product = products.find(p => p.id === item.productId);
                      return (
                        <div 
                          key={item.id} 
                          className="flex flex-wrap items-center justify-between gap-4 p-3 rounded-lg border"
                          data-testid={`item-${item.id}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{product?.name || 'Unknown Product'}</p>
                            <p className="text-sm text-muted-foreground">
                              ${item.unitPrice} × {item.quantity}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">
                              ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    
                    <div className="flex items-center justify-between pt-3 border-t">
                      <span className="font-semibold">Total</span>
                      <span className="text-2xl font-bold" data-testid="text-detail-total">
                        ${Number(selectedOrder.totalAmount).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
