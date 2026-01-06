import { useState, Fragment, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, WholesaleOrderItem, WholesaleUnitType, Flavor } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ShoppingCart, Eye, CalendarIcon, FileText, ArrowUpDown, Loader2, ChevronRight, ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
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

interface EditItem {
  unitTypeId: string;
  flavorId: string;
  quantity: number;
}

export default function WholesaleOrders() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState('pending');
  const [sortOrders, setSortOrders] = useState<Record<string, 'asc' | 'desc'>>({
    pending: 'asc',      // oldest to newest by default
    packaged: 'desc',
    delivered: 'desc',
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const { toast } = useToast();

  const { data: orders = [], isLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/orders"],
  });
  
  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: unitTypes = [] } = useQuery<(WholesaleUnitType & { flavors?: Flavor[] })[]>({
    queryKey: ["/api/wholesale-unit-types"],
    queryFn: async () => apiRequest('GET', '/api/wholesale-unit-types?includeFlavors=true'),
  });

  const { data: flavors = [] } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });

  // Fetch all order items for all orders
  const { data: allOrderItems = [] } = useQuery<WholesaleOrderItem[]>({
    queryKey: ["/api/wholesale/all-order-items"],
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
    mutationFn: async ({ orderId, date }: { orderId: string; date: Date | null }) => {
      return await apiRequest("PATCH", `/api/wholesale/orders/${orderId}`, { 
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

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, items, notes }: { orderId: string; items: EditItem[]; notes: string }) => {
      return await apiRequest("PATCH", `/api/wholesale/orders/${orderId}`, { 
        items,
        notes: notes || null
      });
    },
    onSuccess: () => {
      toast({
        title: "Order Updated",
        description: "Order has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/all-order-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders", selectedOrderId, "items"] });
      setIsEditMode(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update order",
        variant: "destructive",
      });
    },
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (orderId: string) => {
      return await apiRequest("DELETE", `/api/wholesale/orders/${orderId}`);
    },
    onSuccess: () => {
      toast({
        title: "Order Deleted",
        description: "Order has been deleted successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/all-order-items"] });
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete order",
        variant: "destructive",
      });
    },
  });

  const initializeEditMode = () => {
    if (selectedOrder && orderItems) {
      setEditItems(orderItems.map(item => ({
        unitTypeId: item.unitTypeId || '',
        flavorId: item.flavorId || '',
        quantity: item.quantity,
      })));
      setEditNotes(selectedOrder.notes || '');
      setIsEditMode(true);
    }
  };

  const handleAddItem = () => {
    setEditItems([...editItems, { unitTypeId: '', flavorId: '', quantity: 1 }]);
  };

  const handleRemoveItem = (index: number) => {
    setEditItems(editItems.filter((_, i) => i !== index));
  };

  const handleItemChange = (index: number, field: keyof EditItem, value: string | number) => {
    const newItems = [...editItems];
    if (field === 'quantity') {
      newItems[index][field] = Number(value);
    } else {
      newItems[index][field] = value as string;
    }
    setEditItems(newItems);
  };

  const handleSaveOrder = () => {
    if (!selectedOrderId) return;
    const validItems = editItems.filter(item => item.unitTypeId && item.flavorId && item.quantity > 0);
    if (validItems.length === 0) {
      toast({
        title: "Error",
        description: "Order must have at least one valid item",
        variant: "destructive",
      });
      return;
    }
    updateOrderMutation.mutate({
      orderId: selectedOrderId,
      items: validItems,
      notes: editNotes,
    });
  };

  const handleCloseDialog = () => {
    setSelectedOrderId(null);
    setIsEditMode(false);
    setEditItems([]);
    setEditNotes('');
  };

  const toggleSort = (status: string) => {
    setSortOrders(prev => ({
      ...prev,
      [status]: prev[status] === 'asc' ? 'desc' : 'asc',
    }));
  };

  const toggleRowExpansion = (orderId: string) => {
    setExpandedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(orderId)) {
        newSet.delete(orderId);
      } else {
        newSet.add(orderId);
      }
      return newSet;
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

    // Calculate totals for this status
    const totalOrders = filteredOrders.length;
    const totalAmount = filteredOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0);

    // Consolidate items for all orders in this status
    const orderIds = filteredOrders.map(order => order.id);
    const statusItems = allOrderItems.filter(item => 
      orderIds.includes(item.orderId) && item.unitTypeId && item.flavorId
    );
    
    // Group items by unitTypeId + flavorId combination
    const consolidatedItems = statusItems.reduce((acc, item) => {
      if (!item.unitTypeId || !item.flavorId) return acc;
      
      const key = `${item.unitTypeId}-${item.flavorId}`;
      if (!acc[key]) {
        acc[key] = {
          unitTypeId: item.unitTypeId,
          flavorId: item.flavorId,
          quantity: 0,
        };
      }
      acc[key].quantity += item.quantity;
      return acc;
    }, {} as Record<string, { unitTypeId: string; flavorId: string; quantity: number }>);

    const consolidatedList = Object.values(consolidatedItems);

    return (
      <div className="space-y-4">
        {/* Consolidated Items Summary - Grid Layout (hide for delivered orders) */}
        {consolidatedList.length > 0 && status !== 'delivered' && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg">Items to Prepare</h3>
                <Badge variant="secondary" data-testid={`badge-item-count-${status}`}>
                  {consolidatedList.length} {consolidatedList.length === 1 ? 'item type' : 'item types'}
                </Badge>
              </div>
              
              {/* Build grid: flavors across top, units on side */}
              {(() => {
                // Show ALL flavors in columns
                const gridFlavors = flavors;
                
                // Get unique unit types from consolidated items only
                const uniqueUnitTypeIds = Array.from(new Set(consolidatedList.map(item => item.unitTypeId)));
                const gridUnitTypes = uniqueUnitTypeIds.map(id => unitTypes.find(ut => ut.id === id)).filter(Boolean);
                
                // Create a lookup map for quantities
                const quantityMap = new Map<string, number>();
                consolidatedList.forEach(item => {
                  const key = `${item.unitTypeId}-${item.flavorId}`;
                  quantityMap.set(key, item.quantity);
                });
                
                return (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="font-semibold">Unit Type</TableHead>
                          {gridFlavors.map(flavor => (
                            <TableHead key={flavor!.id} className="text-center font-semibold">
                              {flavor!.name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {gridUnitTypes.map(unitType => (
                          <TableRow key={unitType!.id}>
                            <TableCell className="font-medium">{unitType!.name}</TableCell>
                            {gridFlavors.map(flavor => {
                              const key = `${unitType!.id}-${flavor!.id}`;
                              const quantity = quantityMap.get(key);
                              return (
                                <TableCell 
                                  key={flavor!.id} 
                                  className="text-center"
                                  data-testid={`grid-cell-${unitType!.id}-${flavor!.id}`}
                                >
                                  {quantity ? (
                                    <Badge variant="default">{quantity}</Badge>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })()}
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
        
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Order Date</TableHead>
                <TableHead>Order Items</TableHead>
                <TableHead>Scheduled Delivery</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* Summary Row */}
              <TableRow className="bg-muted/50 font-semibold" data-testid={`row-summary-${status}`}>
                <TableCell colSpan={6}>
                  Total {getStatusLabel(status)} Orders
                </TableCell>
                <TableCell className="text-right" data-testid={`text-total-amount-${status}`}>
                  ${totalAmount.toFixed(2)}
                </TableCell>
                <TableCell className="text-muted-foreground" data-testid={`text-total-orders-${status}`}>
                  {totalOrders} {totalOrders === 1 ? 'order' : 'orders'}
                </TableCell>
              </TableRow>
              {filteredOrders.map((order) => {
                const customer = customers?.find(c => c.id === order.customerId);
                const isExpanded = expandedRows.has(order.id);
                
                return (
                  <Fragment key={order.id}>
                    <TableRow data-testid={`row-wholesale-order-${order.id}`}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => toggleRowExpansion(order.id)}
                          data-testid={`button-expand-${order.id}`}
                          className="h-6 w-6"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium" data-testid={`text-customer-${order.id}`}>
                          {customer?.businessName || 'Unknown Customer'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          Invoice: {order.invoiceNumber}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-order-date-${order.id}`}>
                        {new Date(order.orderDate).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedOrderId(order.id)}
                          data-testid={`button-view-items-${order.id}`}
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          View Items
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="justify-start text-left font-normal"
                              data-testid={`button-delivery-date-${order.id}`}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {order.deliveryDate ? (
                                format(new Date(order.deliveryDate), "MMM dd, yyyy")
                              ) : (
                                <span className="text-muted-foreground">Set date</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={order.deliveryDate ? new Date(order.deliveryDate) : undefined}
                              onSelect={(date) => {
                                updateDeliveryDateMutation.mutate({ 
                                  orderId: order.id, 
                                  date: date || null 
                                });
                              }}
                              disabled={updateDeliveryDateMutation.isPending}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={order.status}
                          onValueChange={(newStatus) => 
                            updateStatusMutation.mutate({ orderId: order.id, status: newStatus })
                          }
                          disabled={updateStatusMutation.isPending}
                        >
                          <SelectTrigger 
                            className="w-[140px]" 
                            data-testid={`select-wholesale-order-status-${order.id}`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pending" data-testid="status-pending">
                              Pending
                            </SelectItem>
                            <SelectItem value="packaged" data-testid="status-packaged">
                              Packaged
                            </SelectItem>
                            <SelectItem value="delivered" data-testid="status-delivered">
                              Delivered
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right font-semibold" data-testid={`text-total-${order.id}`}>
                        ${Number(order.totalAmount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => window.open(`/wholesale/invoice/${order.id}`, '_blank')}
                            data-testid={`button-invoice-${order.id}`}
                            title="View Invoice"
                          >
                            <FileText className="w-4 h-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                data-testid={`button-delete-order-${order.id}`}
                                title="Delete Order"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Order</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete order {order.invoiceNumber}? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel data-testid={`button-cancel-delete-${order.id}`}>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteOrderMutation.mutate(order.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  data-testid={`button-confirm-delete-${order.id}`}
                                >
                                  {deleteOrderMutation.isPending ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : "Delete"}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                    
                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={8} className="bg-muted/50">
                          <div className="py-4 px-6 space-y-3">
                            <h4 className="font-semibold text-sm">Customer Details</h4>
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">Contact:</span>{" "}
                                <span className="font-medium">{customer?.contactName}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Email:</span>{" "}
                                <span className="font-medium">{customer?.email}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Phone:</span>{" "}
                                <span className="font-medium">{customer?.phone}</span>
                              </div>
                            </div>
                            {order.notes && (
                              <div className="pt-3 border-t">
                                <span className="text-muted-foreground text-sm">Notes:</span>{" "}
                                <span className="text-sm italic">{order.notes}</span>
                              </div>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
              {renderOrdersTable('pending')}
            </TabsContent>

            <TabsContent value="packaged">
              {renderOrdersTable('packaged')}
            </TabsContent>

            <TabsContent value="delivered">
              {renderOrdersTable('delivered')}
            </TabsContent>
          </Tabs>
        )}
      </div>

      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle>{isEditMode ? 'Edit Order' : 'Order Details'}</DialogTitle>
                <DialogDescription>
                  Invoice: {selectedOrder?.invoiceNumber}
                </DialogDescription>
              </div>
              {!isEditMode && (
                <div className="flex items-center gap-2">
                  {selectedOrder?.status !== 'delivered' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={initializeEditMode}
                      data-testid="button-edit-order"
                    >
                      <Pencil className="w-4 h-4 mr-2" />
                      Edit Order
                    </Button>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        data-testid="button-delete-order"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Order</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this order ({selectedOrder?.invoiceNumber})? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => selectedOrderId && deleteOrderMutation.mutate(selectedOrderId)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          data-testid="button-confirm-delete"
                        >
                          {deleteOrderMutation.isPending ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          ) : null}
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </DialogHeader>
          
          {selectedOrder && selectedCustomer && (
            <div className="space-y-6">
              <div>
                <h3 className="font-semibold mb-2">Customer Information</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><strong>Business:</strong> {selectedCustomer.businessName}</div>
                  <div><strong>Contact:</strong> {selectedCustomer.contactName}</div>
                  <div><strong>Email:</strong> {selectedCustomer.email}</div>
                  <div><strong>Phone:</strong> {selectedCustomer.phone}</div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold mb-2">Order Information</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div><strong>Order Date:</strong> {new Date(selectedOrder.orderDate).toLocaleDateString()}</div>
                  <div><strong>Status:</strong> {getStatusLabel(selectedOrder.status)}</div>
                  {selectedOrder.deliveryDate && (
                    <div><strong>Delivery Date:</strong> {new Date(selectedOrder.deliveryDate).toLocaleDateString()}</div>
                  )}
                  <div><strong>Total:</strong> ${Number(selectedOrder.totalAmount).toFixed(2)}</div>
                </div>
                {!isEditMode && selectedOrder.notes && (
                  <div className="mt-2">
                    <strong>Notes:</strong> <span className="italic">{selectedOrder.notes}</span>
                  </div>
                )}
              </div>

              {isEditMode ? (
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold">Order Items</h3>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleAddItem}
                        data-testid="button-add-item"
                      >
                        <Plus className="w-4 h-4 mr-2" />
                        Add Item
                      </Button>
                    </div>
                    <div className="space-y-3">
                      {editItems.map((item, index) => (
                        <div key={index} className="flex items-center gap-2 p-3 border rounded-md">
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Unit Type</Label>
                            <Select
                              value={item.unitTypeId}
                              onValueChange={(value) => handleItemChange(index, 'unitTypeId', value)}
                            >
                              <SelectTrigger data-testid={`select-unit-type-${index}`}>
                                <SelectValue placeholder="Select unit type" />
                              </SelectTrigger>
                              <SelectContent>
                                {unitTypes.map((ut) => (
                                  <SelectItem key={ut.id} value={ut.id}>
                                    {ut.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex-1">
                            <Label className="text-xs text-muted-foreground">Flavor</Label>
                            <Select
                              value={item.flavorId}
                              onValueChange={(value) => handleItemChange(index, 'flavorId', value)}
                            >
                              <SelectTrigger data-testid={`select-flavor-${index}`}>
                                <SelectValue placeholder="Select flavor" />
                              </SelectTrigger>
                              <SelectContent>
                                {flavors.map((f) => (
                                  <SelectItem key={f.id} value={f.id}>
                                    {f.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="w-20">
                            <Label className="text-xs text-muted-foreground">Qty</Label>
                            <Input
                              type="number"
                              min="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(index, 'quantity', e.target.value)}
                              data-testid={`input-quantity-${index}`}
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleRemoveItem(index)}
                            disabled={editItems.length <= 1}
                            data-testid={`button-remove-item-${index}`}
                            className="mt-5"
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="edit-notes">Notes</Label>
                    <Textarea
                      id="edit-notes"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Add any notes about this order..."
                      className="mt-1"
                      data-testid="textarea-notes"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="font-semibold mb-2">Order Items</h3>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Quantity</TableHead>
                        <TableHead className="text-right">Unit Price</TableHead>
                        <TableHead className="text-right">Subtotal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderItems.map((item) => {
                        const subtotal = Number(item.unitPrice) * item.quantity;
                        const unitType = unitTypes.find(ut => ut.id === item.unitTypeId);
                        const flavor = flavors.find(f => f.id === item.flavorId);
                        const itemName = `${flavor?.name || 'Unknown Flavor'} - ${unitType?.name || 'Unknown Unit Type'}`;
                        
                        return (
                          <TableRow key={item.id}>
                            <TableCell>{itemName}</TableCell>
                            <TableCell className="text-right">{item.quantity}</TableCell>
                            <TableCell className="text-right">${Number(item.unitPrice).toFixed(2)}</TableCell>
                            <TableCell className="text-right">${subtotal.toFixed(2)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          {isEditMode && (
            <DialogFooter className="gap-2">
              <Button
                variant="outline"
                onClick={() => setIsEditMode(false)}
                data-testid="button-cancel-edit"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveOrder}
                disabled={updateOrderMutation.isPending}
                data-testid="button-save-order"
              >
                {updateOrderMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
