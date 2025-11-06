import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, WholesaleOrderItem, Product } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { LayoutDashboard, Package, Users, ShoppingCart, CalendarIcon, FileText, Printer } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";

function WholesaleSidebar() {
  const [location, setLocation] = useLocation();
  
  const menuItems = [
    { title: "Dashboard", icon: LayoutDashboard, path: "/wholesale" },
    { title: "Place Order", icon: ShoppingCart, path: "/wholesale/place-order" },
    { title: "Orders", icon: ShoppingCart, path: "/wholesale/orders" },
    { title: "Delivery Report", icon: FileText, path: "/wholesale/delivery-report" },
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
                    data-testid={`nav-${item.title.toLowerCase().replace(' ', '-')}`}
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

export default function WholesaleDeliveryReport() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());

  const { data: orders = [], isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/delivery-report", selectedDate.toISOString()],
    queryFn: async () => {
      const response = await fetch(`/api/wholesale/delivery-report?date=${selectedDate.toISOString()}`);
      if (!response.ok) {
        throw new Error('Failed to fetch delivery report');
      }
      return response.json();
    },
  });
  
  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: allOrderItems = [] } = useQuery<WholesaleOrderItem[]>({
    queryKey: ["/api/wholesale/all-order-items"],
    queryFn: async () => {
      const items: WholesaleOrderItem[] = [];
      for (const order of orders) {
        const response = await fetch(`/api/wholesale/orders/${order.id}/items`);
        if (response.ok) {
          const orderItems = await response.json();
          items.push(...orderItems);
        }
      }
      return items;
    },
    enabled: orders.length > 0,
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

  const handlePrint = () => {
    window.print();
  };

  const totalAmount = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  const totalOrders = orders.length;

  const style = {
    "--sidebar-width": "16rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <WholesaleSidebar />
        <div className="flex flex-col flex-1">
          <header className="flex items-center justify-between p-4 border-b gap-4 print:hidden">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Daily Delivery Report</h1>
            <div className="w-10" />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto space-y-6">
              <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between print:hidden">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-start text-left font-normal"
                      data-testid="button-select-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant="outline"
                  onClick={handlePrint}
                  data-testid="button-print"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Report
                </Button>
              </div>

              <div className="hidden print:block mb-6">
                <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                  Daily Delivery Report
                </h1>
                <p className="text-lg text-muted-foreground">
                  {format(selectedDate, "PPPP")}
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3 print:grid-cols-3">
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-orders">{totalOrders}</div>
                  </CardContent>
                </Card>
                
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Value</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-value">
                      ${totalAmount.toFixed(2)}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Unique Customers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-unique-customers">
                      {new Set(orders.map(o => o.customerId)).size}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>
                    Scheduled Deliveries
                  </CardTitle>
                  <CardDescription>
                    Orders scheduled for delivery on {format(selectedDate, "MMMM d, yyyy")}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ordersLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : orders.length > 0 ? (
                    <div className="space-y-4">
                      {orders.map((order) => {
                        const customer = customers.find(c => c.id === order.customerId);
                        const orderItems = allOrderItems.filter(item => item.orderId === order.id);
                        
                        return (
                          <div 
                            key={order.id} 
                            className="border rounded-lg p-4 space-y-3 print:break-inside-avoid"
                            data-testid={`delivery-${order.id}`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <h3 className="font-semibold text-lg">
                                    {customer?.businessName || 'Unknown Customer'}
                                  </h3>
                                  <Badge variant={getStatusColor(order.status)} className="capitalize">
                                    {order.status}
                                  </Badge>
                                </div>
                                <div className="text-sm text-muted-foreground space-y-1">
                                  <p>Contact: {customer?.contactName}</p>
                                  <p>Phone: {customer?.phone}</p>
                                  <p>Address: {customer?.address}</p>
                                  {order.notes && (
                                    <p className="italic mt-2">Notes: {order.notes}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm text-muted-foreground">Order Total</p>
                                <p className="text-2xl font-bold">
                                  ${Number(order.totalAmount).toFixed(2)}
                                </p>
                              </div>
                            </div>

                            {orderItems.length > 0 && (
                              <div className="mt-3 pt-3 border-t">
                                <p className="text-sm font-medium mb-2">Items:</p>
                                <div className="space-y-2">
                                  {orderItems.map((item) => {
                                    const product = products.find(p => p.id === item.productId);
                                    return (
                                      <div 
                                        key={item.id}
                                        className="flex items-center justify-between text-sm"
                                      >
                                        <span>
                                          {product?.name || 'Unknown Product'} × {item.quantity}
                                        </span>
                                        <span className="font-medium">
                                          ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        No deliveries scheduled for this date
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
