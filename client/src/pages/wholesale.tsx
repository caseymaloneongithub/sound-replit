import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, Product } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LayoutDashboard, Package, Users, ShoppingCart, TrendingUp, DollarSign, Clock, Warehouse } from "lucide-react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

function WholesaleSidebar() {
  const [location, setLocation] = useLocation();
  
  const menuItems = [
    { title: "Dashboard", icon: LayoutDashboard, path: "/wholesale" },
    { title: "Place Order", icon: ShoppingCart, path: "/wholesale/place-order" },
    { title: "Orders", icon: ShoppingCart, path: "/wholesale/orders" },
    { title: "Customers", icon: Users, path: "/wholesale/customers" },
    { title: "Products", icon: Package, path: "/wholesale/products" },
    { title: "Inventory", icon: Warehouse, path: "/inventory" },
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

export default function Wholesale() {
  const { user } = useAuth();
  const { data: orders } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/orders"],
  });
  
  const { data: customers } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const totalRevenue = orders?.reduce((sum, order) => sum + Number(order.totalAmount), 0) || 0;
  const pendingOrders = orders?.filter(o => o.status === 'pending').length || 0;
  const activeCustomers = customers?.length || 0;

  const recentOrders = orders?.slice(0, 5) || [];

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
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Dashboard</h1>
            <div className="w-10" />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto space-y-8">
              <div className={`grid gap-6 ${isAdmin ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                {isAdmin && (
                  <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                      <DollarSign className="w-4 h-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold" data-testid="text-total-revenue">
                        ${totalRevenue.toFixed(2)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        All-time wholesale sales
                      </p>
                    </CardContent>
                  </Card>
                )}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
                    <Clock className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold" data-testid="text-pending-orders">
                      {pendingOrders}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Awaiting processing
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Active Customers</CardTitle>
                    <Users className="w-4 h-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold" data-testid="text-active-customers">
                      {activeCustomers}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Wholesale accounts
                    </p>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Recent Orders</CardTitle>
                  <CardDescription>Latest wholesale orders from your customers</CardDescription>
                </CardHeader>
                <CardContent>
                  {recentOrders.length === 0 ? (
                    <div className="text-center py-12">
                      <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">No orders yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recentOrders.map((order) => {
                        const customer = customers?.find(c => c.id === order.customerId);
                        return (
                          <div 
                            key={order.id} 
                            className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                            data-testid={`order-${order.id}`}
                          >
                            <div className="flex-1">
                              <p className="font-medium">{customer?.businessName || 'Unknown Customer'}</p>
                              <p className="text-sm text-muted-foreground">
                                {new Date(order.orderDate).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="font-semibold">${Number(order.totalAmount).toFixed(2)}</p>
                              </div>
                              <Badge variant={getStatusColor(order.status)} className="capitalize">
                                {order.status}
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
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
