import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, WholesaleOrderItem, Product } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LayoutDashboard, Package, Users, ShoppingCart, Eye, CalendarIcon, FileText } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

function WholesaleSidebar() {
  const [location, setLocation] = useLocation();
  
  const menuItems = [
    { title: "Dashboard", icon: LayoutDashboard, path: "/staff-portal" },
    { title: "Place Order", icon: ShoppingCart, path: "/wholesale/place-order" },
    { title: "Orders", icon: ShoppingCart, path: "/wholesale/orders" },
    { title: "Delivery Report", icon: CalendarIcon, path: "/wholesale/delivery-report" },
    { title: "Customers", icon: Users, path: "/wholesale/customers" },
    { title: "Products", icon: Package, path: "/wholesale/products" },
  ];

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-lg font-semibold px-4 py-3" style={{ fontFamily: 'var(--font-heading)' }}>
            Wholesale Portal
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    onClick={() => setLocation(item.path)}
                    isActive={location === item.path}
                    data-testid={`nav-${item.title.toLowerCase()}`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function WholesaleOrders() {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<string>("");
  const [deliveryDate, setDeliveryDate] = useState<Date | undefined>(undefined);
  const { toast } = useToast();

  const { data: orders, isLoading } = useQuery<WholesaleOrder[]>({
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
    mutationFn: async (status: string) => {
      const response = await apiRequest("PATCH", `/api/wholesale/orders/${selectedOrderId}`, { status });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Status Updated",
        description: "Order status has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setNewStatus("");
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
      const response = await apiRequest("PATCH", `/api/wholesale/orders/${selectedOrderId}`, { 
        deliveryDate: date ? date.toISOString() : null 
      });
      return await response.json();
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'secondary';
      case 'processing': return 'default';
      case 'shipped': return 'default';
      case 'delivered': return 'secondary';
      default: return 'secondary';
    }
  };

  const style = {
    "--sidebar-width": "16rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <WholesaleSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-4 border-b gap-4">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Orders</h1>
            <div className="w-10" />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto">
              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>All Wholesale Orders</CardTitle>
                  <CardDescription>Manage and track wholesale customer orders</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : orders && orders.length > 0 ? (
                    <div className="space-y-3">
                      {orders.map((order) => {
                        const customer = customers?.find(c => c.id === order.customerId);
                        return (
                          <div 
                            key={order.id} 
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border hover-elevate"
                            data-testid={`order-${order.id}`}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold truncate">{customer?.businessName || 'Unknown Customer'}</p>
                              <p className="text-sm text-muted-foreground">
                                Order #{order.id.slice(0, 8)} • {new Date(order.orderDate).toLocaleDateString()}
                              </p>
                              {order.notes && (
                                <p className="text-sm text-muted-foreground mt-1 italic">{order.notes}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 justify-between sm:justify-end flex-wrap">
                              <div className="text-right">
                                <p className="font-bold text-lg">${Number(order.totalAmount).toFixed(2)}</p>
                              </div>
                              <Badge variant={getStatusColor(order.status)} className="capitalize shrink-0">
                                {order.status}
                              </Badge>
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
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">No orders yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>

      <Dialog open={!!selectedOrderId} onOpenChange={(open) => !open && setSelectedOrderId(null)}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ fontFamily: 'var(--font-heading)' }}>Order Details</DialogTitle>
            <DialogDescription>
              Order #{selectedOrderId?.slice(0, 8)} • {selectedOrder && new Date(selectedOrder.orderDate).toLocaleDateString()}
            </DialogDescription>
          </DialogHeader>
          
          {selectedOrder && (
            <div className="space-y-6">
              <div className="grid md:grid-cols-3 gap-4">
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Customer</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="font-semibold">{selectedCustomer?.businessName}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer?.contactName}</p>
                    <p className="text-sm text-muted-foreground">{selectedCustomer?.email}</p>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Order Status</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Badge variant={getStatusColor(selectedOrder.status)} className="capitalize">
                      {selectedOrder.status}
                    </Badge>
                    <Select 
                      value={newStatus || selectedOrder.status} 
                      onValueChange={setNewStatus}
                    >
                      <SelectTrigger data-testid="select-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="processing">Processing</SelectItem>
                        <SelectItem value="shipped">Shipped</SelectItem>
                        <SelectItem value="delivered">Delivered</SelectItem>
                      </SelectContent>
                    </Select>
                    {newStatus && newStatus !== selectedOrder.status && (
                      <Button
                        className="w-full"
                        size="sm"
                        onClick={() => updateStatusMutation.mutate(newStatus)}
                        disabled={updateStatusMutation.isPending}
                        data-testid="button-update-status"
                      >
                        Update Status
                      </Button>
                    )}
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
    </SidebarProvider>
  );
}
