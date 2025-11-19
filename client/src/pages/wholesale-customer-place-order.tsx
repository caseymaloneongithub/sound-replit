import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Product, ProductType, WholesalePricing } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Trash2, ShoppingCart, ArrowLeft } from "lucide-react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { CASE_SIZE, formatCaseQuantity } from "@shared/pricing";

interface CartItem {
  productId: string;
  quantity: number;
}

export default function WholesaleCustomerPlaceOrder() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState("");
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productTypes = [] } = useQuery<ProductType[]>({
    queryKey: ["/api/product-types"],
  });

  const { data: pricing = [] } = useQuery<WholesalePricing[]>({
    queryKey: ["/api/wholesale/customer/pricing"],
  });

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (cart.length === 0) {
        throw new Error("Cart is empty");
      }

      return await apiRequest("POST", "/api/wholesale/customer/orders", {
        notes: notes || undefined,
        items: cart,
      });
    },
    onSuccess: () => {
      toast({
        title: "Order Created",
        description: "Your wholesale order has been placed successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/orders"] });
      setCart([]);
      setNotes("");
      setLocation("/wholesale-customer");
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
    const product = products.find(p => p.id === productId);
    if (!product) return 0;
    
    // Check for customer-specific pricing based on product type
    const customPrice = pricing.find(p => p.productTypeId === product.productTypeId);
    if (customPrice) {
      return Number(customPrice.customPrice) * CASE_SIZE;
    }
    
    // Fall back to default wholesale price from product type
    const productType = productTypes.find(pt => pt.id === product.productTypeId);
    return productType ? Number(productType.wholesalePrice) * CASE_SIZE : 0;
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

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Place Order</h1>
            <p className="text-muted-foreground">
              Select products and place your wholesale order
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={() => setLocation('/wholesale-customer')}
            data-testid="button-back"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Available Products</CardTitle>
              <CardDescription>Select products to add to your order</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {products.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No products available</p>
                ) : (
                  products.map((product) => {
                    const price = getPrice(product.id);
                    const hasCustomPrice = pricing.some(p => p.productTypeId === product.productTypeId);
                    
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
                  })
                )}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>
                  Cart ({cart.length} {cart.length === 1 ? 'item' : 'items'})
                </CardTitle>
                <CardDescription>Review and adjust quantities</CardDescription>
              </CardHeader>
              <CardContent>
                {cart.length === 0 ? (
                  <div className="text-center py-8">
                    <ShoppingCart className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
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
                          className="flex items-center gap-4 p-3 rounded-lg border"
                          data-testid={`cart-item-${item.productId}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-medium truncate">{product?.name}</p>
                            <p className="text-sm font-medium mb-1">
                              {formatCaseQuantity(item.quantity)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              ${(price * item.quantity).toFixed(2)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="icon"
                              variant="outline"
                              onClick={() => updateQuantity(item.productId, item.quantity - 1)}
                              data-testid={`button-decrease-${item.productId}`}
                            >
                              <Minus className="w-4 h-4" />
                            </Button>
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) => updateQuantity(item.productId, parseInt(e.target.value) || 0)}
                              className="w-16 text-center"
                              min="0"
                              data-testid={`input-quantity-${item.productId}`}
                            />
                            <Button
                              size="icon"
                              variant="outline"
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
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {cart.length > 0 && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Order Notes</CardTitle>
                    <CardDescription>Add any special instructions (optional)</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Enter any special instructions or notes..."
                      rows={3}
                      data-testid="textarea-notes"
                    />
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Order Summary</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex justify-between text-lg font-bold">
                        <span>Total:</span>
                        <span data-testid="text-total">${getCartTotal().toFixed(2)}</span>
                      </div>
                    </div>
                    <Button
                      className="w-full mt-4"
                      onClick={() => createOrderMutation.mutate()}
                      disabled={createOrderMutation.isPending || cart.length === 0}
                      data-testid="button-place-order"
                    >
                      {createOrderMutation.isPending ? 'Placing Order...' : 'Place Order'}
                    </Button>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
