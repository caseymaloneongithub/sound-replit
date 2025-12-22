import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ShoppingCart, Loader2, Package, XCircle, ArrowUpDown, DollarSign, ChevronDown, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { RetailOrder } from "@shared/schema";

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: string;
  productName: string;
  flavorName: string | null;
  unitDescription: string;
}

interface RetailOrderWithItems extends RetailOrder {
  items: OrderItem[];
}

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
  const [activeTab, setActiveTab] = useState('pending');
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [sortOrders, setSortOrders] = useState<Record<string, 'asc' | 'desc'>>({
    pending: 'asc',
    ready_for_pickup: 'desc',
    fulfilled: 'desc',
    cancelled: 'desc',
  });

  const { data: orders = [], isLoading } = useQuery<RetailOrderWithItems[]>({
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

  const cancelOrderWithRefundMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest('POST', `/api/retail/orders/${orderId}/cancel-with-refund`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/orders'] });
      toast({
        title: "Order cancelled",
        description: "Order has been cancelled and refund has been processed",
      });
    },
    onError: async (error: any) => {
      let errorMessage = "Failed to cancel order with refund";
      let errorDetails = "";
      
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorMessage;
          if (errorData.action) {
            errorDetails = errorData.action;
          }
          if (errorData.paymentIntentId) {
            errorDetails += `\nPayment Intent: ${errorData.paymentIntentId}`;
          }
        } catch {
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Error",
        description: errorDetails ? `${errorMessage}\n${errorDetails}` : errorMessage,
        variant: "destructive",
      });
    },
  });

  const refundDepositMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest('POST', `/api/retail/orders/${orderId}/refund-deposit`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/orders'] });
      toast({
        title: "Deposit refunded",
        description: `Deposit of $${data.amount?.toFixed(2) || '0.00'} has been refunded successfully`,
      });
    },
    onError: async (error: any) => {
      let errorMessage = "Failed to refund deposit";
      
      if (error instanceof Response) {
        try {
          const errorData = await error.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        title: "Error",
        description: errorMessage,
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

  const toggleExpand = (orderId: string) => {
    setExpandedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
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

  const renderOrdersTable = (status: string) => {
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

    const consolidatedItems = (status === 'pending' || status === 'ready_for_pickup') ? (() => {
      const itemMap: Record<string, { productName: string; unitDescription: string; quantity: number }> = {};
      
      filteredOrders.forEach(order => {
        order.items?.forEach(item => {
          const key = `${item.productName}-${item.unitDescription}`;
          if (!itemMap[key]) {
            itemMap[key] = {
              productName: item.productName,
              unitDescription: item.unitDescription,
              quantity: 0,
            };
          }
          itemMap[key].quantity += item.quantity;
        });
      });
      
      return Object.values(itemMap).sort((a, b) => a.productName.localeCompare(b.productName));
    })() : [];

    const summaryTitle = status === 'pending' ? 'Items to Prepare' : 'Items Packaged';

    return (
      <div className="space-y-4">
        {(status === 'pending' || status === 'ready_for_pickup') && consolidatedItems.length > 0 && (
          <Card data-testid={`card-items-summary-${status}`}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
                <h3 className="font-semibold text-lg flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  {summaryTitle}
                </h3>
                <Badge variant="secondary" data-testid={`badge-item-count-${status}`}>
                  {consolidatedItems.length} {consolidatedItems.length === 1 ? 'product' : 'products'}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {consolidatedItems.map((item, index) => (
                  <div 
                    key={index}
                    className="flex justify-between items-center bg-muted/50 rounded-md px-3 py-2"
                    data-testid={`summary-item-${status}-${index}`}
                  >
                    <div className="flex-1">
                      <span className="font-medium">{item.productName}</span>
                      {item.unitDescription && (
                        <span className="text-muted-foreground text-sm ml-1">
                          ({item.unitDescription})
                        </span>
                      )}
                    </div>
                    <Badge variant="default" className="ml-2">
                      {item.quantity}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

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

        <Card>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Order #</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((order) => {
                  const isExpanded = expandedOrders.has(order.id);
                  return (
                    <Collapsible key={order.id} open={isExpanded} onOpenChange={() => toggleExpand(order.id)} asChild>
                      <>
                        <TableRow 
                          className="cursor-pointer hover-elevate"
                          data-testid={`row-retail-order-${order.id}`}
                        >
                          <TableCell>
                            <CollapsibleTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-6 w-6" data-testid={`button-expand-${order.id}`}>
                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </Button>
                            </CollapsibleTrigger>
                          </TableCell>
                          <TableCell className="font-medium" data-testid={`text-order-number-${order.id}`}>
                            #{order.orderNumber}
                          </TableCell>
                          <TableCell data-testid={`text-customer-name-${order.id}`}>
                            {order.customerName}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm">
                              <div data-testid={`text-customer-email-${order.id}`}>{order.customerEmail}</div>
                              <div className="text-muted-foreground" data-testid={`text-customer-phone-${order.id}`}>{order.customerPhone}</div>
                            </div>
                          </TableCell>
                          <TableCell data-testid={`text-order-date-${order.id}`}>
                            {new Date(order.orderDate).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="font-semibold" data-testid={`text-order-total-${order.id}`}>
                              ${Number(order.totalAmount).toFixed(2)}
                            </div>
                            {Number(order.depositAmount || 0) > 0 && (
                              <div className="text-xs text-muted-foreground">
                                Dep: ${Number(order.depositAmount).toFixed(2)}
                                {order.depositRefundedAt && (
                                  <span className="text-green-600 dark:text-green-400"> (Ref)</span>
                                )}
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <Select
                              value={order.status}
                              onValueChange={(status) => 
                                updateOrderStatusMutation.mutate({ orderId: order.id, status })
                              }
                              disabled={updateOrderStatusMutation.isPending || order.status === 'fulfilled' || order.status === 'cancelled'}
                            >
                              <SelectTrigger className="w-[140px] h-8" data-testid={`select-retail-order-status-${order.id}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="pending" data-testid="status-pending">Pending</SelectItem>
                                <SelectItem value="ready_for_pickup" data-testid="status-ready-for-pickup">Ready for Pickup</SelectItem>
                                <SelectItem value="fulfilled" data-testid="status-fulfilled">Fulfilled</SelectItem>
                                <SelectItem value="cancelled" data-testid="status-cancelled">Cancelled</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex gap-1 justify-end flex-wrap">
                              {Number(order.depositAmount || 0) > 0 && !order.depositRefundedAt && order.stripePaymentIntentId && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button 
                                      variant="outline" 
                                      size="sm"
                                      disabled={refundDepositMutation.isPending}
                                      data-testid={`button-refund-deposit-${order.id}`}
                                    >
                                      <DollarSign className="w-3 h-3" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Refund Deposit?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will refund the deposit of ${Number(order.depositAmount).toFixed(2)} to the customer's payment method for order #{order.orderNumber}. 
                                        This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-deposit-refund-dialog">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => refundDepositMutation.mutate(order.id)}
                                        data-testid="button-confirm-deposit-refund"
                                      >
                                        Confirm Refund
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                              {order.status !== 'cancelled' && order.status !== 'fulfilled' && order.stripePaymentIntentId && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button 
                                      variant="destructive" 
                                      size="sm"
                                      disabled={cancelOrderWithRefundMutation.isPending}
                                      data-testid={`button-cancel-order-${order.id}`}
                                    >
                                      <XCircle className="w-3 h-3" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Cancel Order with Refund?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        This will cancel order #{order.orderNumber} and process a full refund of ${Number(order.totalAmount).toFixed(2)} to the customer's payment method. 
                                        This action cannot be undone.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel data-testid="button-cancel-refund-dialog">Cancel</AlertDialogCancel>
                                      <AlertDialogAction
                                        onClick={() => cancelOrderWithRefundMutation.mutate(order.id)}
                                        data-testid="button-confirm-refund"
                                      >
                                        Confirm Refund
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                        <CollapsibleContent asChild>
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={8} className="p-0">
                              <div className="px-6 py-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div>
                                    <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                                      <Package className="w-4 h-4" />
                                      Order Items
                                    </h4>
                                    {order.items && order.items.length > 0 ? (
                                      <div className="space-y-1">
                                        {order.items.map((item) => (
                                          <div 
                                            key={item.id} 
                                            className="flex justify-between items-center text-sm bg-background rounded-md px-3 py-2"
                                            data-testid={`order-item-${item.id}`}
                                          >
                                            <div className="flex-1">
                                              <span className="font-medium">{item.productName}</span>
                                              {item.unitDescription && (
                                                <span className="text-muted-foreground ml-2">
                                                  ({item.unitDescription})
                                                </span>
                                              )}
                                            </div>
                                            <div className="flex items-center gap-4">
                                              <span className="text-muted-foreground">
                                                x{item.quantity}
                                              </span>
                                              <span className="font-medium">
                                                ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                                              </span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <p className="text-sm text-muted-foreground">No items</p>
                                    )}
                                  </div>
                                  <div>
                                    <h4 className="text-sm font-medium mb-2">Order Summary</h4>
                                    <div className="text-sm space-y-1 bg-background rounded-md px-3 py-2">
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Subtotal:</span>
                                        <span>${Number(order.subtotal).toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between">
                                        <span className="text-muted-foreground">Tax:</span>
                                        <span>${Number(order.taxAmount).toFixed(2)}</span>
                                      </div>
                                      {Number(order.depositAmount || 0) > 0 && (
                                        <div className="flex justify-between">
                                          <span className="text-muted-foreground">Deposit:</span>
                                          <span>
                                            ${Number(order.depositAmount).toFixed(2)}
                                            {order.depositRefundedAt && (
                                              <span className="text-green-600 dark:text-green-400 ml-1">(Refunded)</span>
                                            )}
                                          </span>
                                        </div>
                                      )}
                                      <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                                        <span>Total:</span>
                                        <span>${Number(order.totalAmount).toFixed(2)}</span>
                                      </div>
                                      {order.fulfilledAt && (
                                        <div className="text-xs text-muted-foreground pt-2 border-t mt-2">
                                          Fulfilled: {new Date(order.fulfilledAt).toLocaleString()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        </CollapsibleContent>
                      </>
                    </Collapsible>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    );
  };

  const orderCounts = {
    pending: orders.filter(o => o.status === 'pending').length,
    ready_for_pickup: orders.filter(o => o.status === 'ready_for_pickup').length,
    fulfilled: orders.filter(o => o.status === 'fulfilled').length,
    cancelled: orders.filter(o => o.status === 'cancelled').length,
  };

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
          <Tabs value={activeTab} onValueChange={setActiveTab} data-testid="tabs-retail-orders">
            <TabsList className="mb-6">
              <TabsTrigger value="pending" data-testid="tab-pending">
                Pending
                {orderCounts.pending > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="ready_for_pickup" data-testid="tab-ready-for-pickup">
                Ready for Pickup
                {orderCounts.ready_for_pickup > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.ready_for_pickup}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="fulfilled" data-testid="tab-fulfilled">
                Fulfilled
                {orderCounts.fulfilled > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.fulfilled}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="cancelled" data-testid="tab-cancelled">
                Cancelled
                {orderCounts.cancelled > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {orderCounts.cancelled}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending">
              {renderOrdersTable('pending')}
            </TabsContent>
            <TabsContent value="ready_for_pickup">
              {renderOrdersTable('ready_for_pickup')}
            </TabsContent>
            <TabsContent value="fulfilled">
              {renderOrdersTable('fulfilled')}
            </TabsContent>
            <TabsContent value="cancelled">
              {renderOrdersTable('cancelled')}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </StaffLayout>
  );
}
