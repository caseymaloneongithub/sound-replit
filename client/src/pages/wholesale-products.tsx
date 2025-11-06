import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Product, WholesaleCustomer, InsertWholesaleOrder } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LayoutDashboard, Package, Users, ShoppingCart, Plus, Minus, Trash2, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

function WholesaleSidebar() {
  const [location, setLocation] = useLocation();
  
  const menuItems = [
    { title: "Dashboard", icon: LayoutDashboard, path: "/wholesale" },
    { title: "Place Order", icon: ShoppingCart, path: "/wholesale/place-order" },
    { title: "Orders", icon: ShoppingCart, path: "/wholesale/orders" },
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

interface OrderItem {
  productId: string;
  quantity: number;
  unitPrice: string;
}

export default function WholesaleProducts() {
  const [location, setLocation] = useLocation();
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const addToOrder = (product: Product) => {
    const existing = orderItems.find(item => item.productId === product.id);
    if (existing) {
      setOrderItems(orderItems.map(item =>
        item.productId === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setOrderItems([...orderItems, {
        productId: product.id,
        quantity: 1,
        unitPrice: product.wholesalePrice,
      }]);
    }
  };

  const updateQuantity = (productId: string, change: number) => {
    setOrderItems(orderItems.map(item =>
      item.productId === productId
        ? { ...item, quantity: Math.max(1, item.quantity + change) }
        : item
    ).filter(item => item.quantity > 0));
  };

  const removeItem = (productId: string) => {
    setOrderItems(orderItems.filter(item => item.productId !== productId));
  };

  const totalAmount = orderItems.reduce((sum, item) => 
    sum + (Number(item.unitPrice) * item.quantity), 0
  );

  const placeOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomer) {
        throw new Error("Please select a customer");
      }
      if (orderItems.length === 0) {
        throw new Error("Please add at least one product");
      }

      const response = await apiRequest("POST", "/api/wholesale/orders", {
        order: {
          customerId: selectedCustomer,
          totalAmount: totalAmount.toString(),
          status: "pending",
          notes: notes || undefined,
        },
        items: orderItems,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Placed",
        description: "Wholesale order created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setSelectedCustomer("");
      setOrderItems([]);
      setNotes("");
      setLocation("/wholesale/orders");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to place order",
        variant: "destructive",
      });
    },
  });

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
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Products</h1>
            <div className="w-10" />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto space-y-6">
              {orderItems.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>New Order</CardTitle>
                    <CardDescription>Review and place your wholesale order</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Select Customer</label>
                      <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                        <SelectTrigger data-testid="select-customer">
                          <SelectValue placeholder="Choose a customer..." />
                        </SelectTrigger>
                        <SelectContent>
                          {customers.map((customer) => (
                            <SelectItem key={customer.id} value={customer.id}>
                              {customer.businessName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">Order Items</label>
                      <div className="space-y-2">
                        {orderItems.map((item) => {
                          const product = products?.find(p => p.id === item.productId);
                          return (
                            <div 
                              key={item.productId} 
                              className="flex flex-wrap items-center gap-4 p-3 rounded-lg border"
                              data-testid={`order-item-${item.productId}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{product?.name}</p>
                                <p className="text-sm text-muted-foreground">${item.unitPrice} each</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button 
                                  size="icon" 
                                  variant="outline" 
                                  onClick={() => updateQuantity(item.productId, -1)}
                                  data-testid={`button-decrease-${item.productId}`}
                                >
                                  <Minus className="w-4 h-4" />
                                </Button>
                                <span className="w-12 text-center font-medium" data-testid={`text-quantity-${item.productId}`}>
                                  {item.quantity}
                                </span>
                                <Button 
                                  size="icon" 
                                  variant="outline" 
                                  onClick={() => updateQuantity(item.productId, 1)}
                                  data-testid={`button-increase-${item.productId}`}
                                >
                                  <Plus className="w-4 h-4" />
                                </Button>
                              </div>
                              <div className="text-right min-w-24">
                                <p className="font-bold">${(Number(item.unitPrice) * item.quantity).toFixed(2)}</p>
                              </div>
                              <Button 
                                size="icon" 
                                variant="ghost" 
                                onClick={() => removeItem(item.productId)}
                                data-testid={`button-remove-${item.productId}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label className="text-sm font-medium mb-2 block">Notes (Optional)</label>
                      <Textarea
                        placeholder="Add any special instructions..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        data-testid="input-notes"
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t">
                      <div>
                        <p className="text-sm text-muted-foreground">Order Total</p>
                        <p className="text-3xl font-bold" data-testid="text-order-total">
                          ${totalAmount.toFixed(2)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="outline" 
                          onClick={() => setOrderItems([])}
                          data-testid="button-clear-order"
                        >
                          Clear Order
                        </Button>
                        <Button 
                          onClick={() => placeOrderMutation.mutate()}
                          disabled={placeOrderMutation.isPending || !selectedCustomer}
                          data-testid="button-place-order"
                        >
                          {placeOrderMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Placing Order...
                            </>
                          ) : (
                            'Place Order'
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Product Catalog</CardTitle>
                  <CardDescription>
                    {orderItems.length > 0 
                      ? "Add more products to your order" 
                      : "Select products to create a wholesale order"
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-48 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : products && products.length > 0 ? (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {products.map((product) => (
                        <Card key={product.id} className="overflow-hidden hover-elevate" data-testid={`product-${product.id}`}>
                          <CardHeader className="p-0">
                            <div className="aspect-square bg-card overflow-hidden">
                              <img 
                                src={product.imageUrl} 
                                alt={product.name}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          </CardHeader>
                          <CardContent className="p-4">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <h3 className="font-semibold text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
                                {product.name}
                              </h3>
                              <Badge variant={product.inStock ? "secondary" : "destructive"} className="shrink-0">
                                {product.inStock ? 'In Stock' : 'Out of Stock'}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                              {product.description}
                            </p>
                            <div className="space-y-3">
                              <div className="space-y-2">
                                <div className="flex justify-between items-baseline">
                                  <span className="text-sm text-muted-foreground">Retail</span>
                                  <span className="font-semibold">${product.retailPrice}</span>
                                </div>
                                <div className="flex justify-between items-baseline">
                                  <span className="text-sm text-muted-foreground">Wholesale</span>
                                  <span className="text-lg font-bold text-primary">${product.wholesalePrice}</span>
                                </div>
                              </div>
                              <Button 
                                className="w-full"
                                size="sm"
                                onClick={() => addToOrder(product)}
                                disabled={!product.inStock}
                                data-testid={`button-add-${product.id}`}
                              >
                                <Plus className="w-4 h-4 mr-1" />
                                Add to Order
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">No products available</p>
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
