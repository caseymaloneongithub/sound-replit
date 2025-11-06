import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleCustomer, Product, WholesalePricing } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { LayoutDashboard, Package, Users, ShoppingCart, Plus, Minus, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CartItem {
  productId: string;
  quantity: number;
}

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

export default function WholesalePlaceOrder() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: pricing = [] } = useQuery<WholesalePricing[]>({
    queryKey: ["/api/wholesale/pricing", selectedCustomerId],
    enabled: !!selectedCustomerId,
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCustomerId) {
        throw new Error("Please select a customer");
      }
      if (cart.length === 0) {
        throw new Error("Cart is empty");
      }

      const response = await apiRequest("POST", "/api/wholesale/orders", {
        order: {
          customerId: selectedCustomerId,
          notes: notes || undefined,
        },
        items: cart,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Order Created",
        description: "Wholesale order has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/orders"] });
      setCart([]);
      setNotes("");
      setSelectedCustomerId("");
      setLocation("/wholesale/orders");
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create order",
        variant: "destructive",
      });
    },
  });

  const getPrice = (productId: string): number => {
    if (!selectedCustomerId) return 0;
    
    const customPrice = pricing.find(p => p.productId === productId);
    if (customPrice) {
      return Number(customPrice.customPrice);
    }
    
    const product = products.find(p => p.id === productId);
    return product ? Number(product.wholesalePrice) : 0;
  };

  const addToCart = (productId: string) => {
    const existingItem = cart.find(item => item.productId === productId);
    if (existingItem) {
      setCart(cart.map(item => 
        item.productId === productId 
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { productId, quantity: 1 }]);
    }
  };

  const updateQuantity = (productId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(productId);
    } else {
      setCart(cart.map(item => 
        item.productId === productId 
          ? { ...item, quantity }
          : item
      ));
    }
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const getCartTotal = (): number => {
    return cart.reduce((total, item) => {
      const price = getPrice(item.productId);
      return total + (price * item.quantity);
    }, 0);
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
            <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }}>Place Order</h1>
            <div className="w-10" />
          </header>
          <main className="flex-1 overflow-auto p-6">
            <div className="max-w-7xl mx-auto space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Select Customer</CardTitle>
                  <CardDescription>Choose the customer for this order</CardDescription>
                </CardHeader>
                <CardContent>
                  <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                    <SelectTrigger data-testid="select-customer">
                      <SelectValue placeholder="Select a customer..." />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((customer) => (
                        <SelectItem key={customer.id} value={customer.id}>
                          {customer.businessName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {selectedCustomerId && (
                <div className="grid md:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Products</CardTitle>
                      <CardDescription>Select products to add to the order</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {products.map((product) => {
                          const price = getPrice(product.id);
                          const hasCustomPrice = pricing.some(p => p.productId === product.id);
                          
                          return (
                            <div 
                              key={product.id} 
                              className="flex items-center justify-between gap-4 p-3 rounded-lg border"
                              data-testid={`product-${product.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="font-medium truncate">{product.name}</p>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm text-muted-foreground">
                                    ${price.toFixed(2)}/case
                                  </p>
                                  {hasCustomPrice && (
                                    <Badge variant="secondary" className="text-xs">
                                      Custom Price
                                    </Badge>
                                  )}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => addToCart(product.id)}
                                data-testid={`button-add-${product.id}`}
                              >
                                <Plus className="w-4 h-4 mr-1" />
                                Add
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-6">
                    <Card>
                      <CardHeader>
                        <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>
                          Cart ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                        </CardTitle>
                        <CardDescription>Review and adjust quantities</CardDescription>
                      </CardHeader>
                      <CardContent>
                        {cart.length === 0 ? (
                          <div className="text-center py-8">
                            <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                            <p className="text-muted-foreground">Cart is empty</p>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {cart.map((item) => {
                              const product = products.find(p => p.id === item.productId);
                              const price = getPrice(item.productId);
                              
                              return (
                                <div 
                                  key={item.productId} 
                                  className="flex items-center justify-between gap-4 p-3 rounded-lg border"
                                  data-testid={`cart-item-${item.productId}`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium truncate">{product?.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                      ${price.toFixed(2)} × {item.quantity} = ${(price * item.quantity).toFixed(2)}
                                    </p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                                      data-testid={`button-decrease-${item.productId}`}
                                    >
                                      <Minus className="w-4 h-4" />
                                    </Button>
                                    <Input
                                      type="number"
                                      min="1"
                                      value={item.quantity}
                                      onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 0)}
                                      className="w-16 text-center"
                                      data-testid={`input-quantity-${item.productId}`}
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => updateQuantity(item.productId, item.quantity + 1)}
                                      data-testid={`button-increase-${item.productId}`}
                                    >
                                      <Plus className="w-4 h-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => removeFromCart(item.productId)}
                                      data-testid={`button-remove-${item.productId}`}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                            
                            <div className="pt-3 border-t">
                              <div className="flex items-center justify-between">
                                <span className="text-lg font-semibold">Total</span>
                                <span className="text-2xl font-bold" data-testid="text-cart-total">
                                  ${getCartTotal().toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader>
                        <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Order Notes</CardTitle>
                        <CardDescription>Add any special instructions</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Textarea
                          placeholder="Delivery instructions, special requests, etc."
                          value={notes}
                          onChange={(e) => setNotes(e.target.value)}
                          rows={4}
                          data-testid="input-notes"
                        />
                      </CardContent>
                    </Card>

                    <Button
                      className="w-full"
                      size="lg"
                      onClick={() => createOrderMutation.mutate()}
                      disabled={createOrderMutation.isPending || cart.length === 0}
                      data-testid="button-place-order"
                    >
                      {createOrderMutation.isPending ? "Placing Order..." : "Place Order"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
