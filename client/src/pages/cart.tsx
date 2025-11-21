import { useLocation } from "wouter";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ShoppingCart, ArrowRight, Trash2, Plus, Minus } from "lucide-react";
import { useUnifiedCart } from "@/hooks/use-unified-cart";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function Cart() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { items, isLoading } = useUnifiedCart();

  const hasItems = items.length > 0;

  const calculateTotals = () => {
    let subtotal = 0;
    let depositTotal = 0;

    items.forEach(cartItem => {
      if (cartItem.type === 'legacy') {
        const basePrice = cartItem.item.isSubscription ? 54.00 : 60.00;
        subtotal += basePrice * cartItem.item.quantity;
      } else {
        const basePrice = parseFloat(cartItem.item.retailProduct.price);
        const deposit = cartItem.item.retailProduct.deposit ? parseFloat(cartItem.item.retailProduct.deposit) : 0;
        const discountPercentage = cartItem.item.isSubscription 
          ? parseFloat(cartItem.item.retailProduct.subscriptionDiscount) 
          : 0;
        const finalPrice = cartItem.item.isSubscription && discountPercentage > 0
          ? basePrice * (1 - discountPercentage / 100)
          : basePrice;
        subtotal += finalPrice * cartItem.item.quantity;
        depositTotal += deposit * cartItem.item.quantity;
      }
    });

    const TAX_RATE = 0.1035;
    const taxAmount = subtotal * TAX_RATE;
    const total = subtotal + depositTotal + taxAmount;

    return {
      subtotal: subtotal.toFixed(2),
      depositTotal: depositTotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
    };
  };

  const { subtotal, depositTotal, taxAmount, total } = calculateTotals();

  const handleUpdateQuantity = async (itemId: string, newQuantity: number, isRetail: boolean) => {
    if (newQuantity < 1) return;
    
    try {
      if (isRetail) {
        await apiRequest("PATCH", `/api/retail-cart/${itemId}`, { quantity: newQuantity });
        await queryClient.invalidateQueries({ queryKey: ['/api/retail-cart'] });
      } else {
        await apiRequest("PATCH", `/api/cart/${itemId}`, { quantity: newQuantity });
        await queryClient.invalidateQueries({ queryKey: ['/api/cart'] });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update quantity",
        variant: "destructive",
      });
    }
  };

  const handleRemoveItem = async (itemId: string, isRetail: boolean) => {
    try {
      if (isRetail) {
        await apiRequest("DELETE", `/api/retail-cart/${itemId}`);
        await queryClient.invalidateQueries({ queryKey: ['/api/retail-cart'] });
      } else {
        await apiRequest("DELETE", `/api/cart/${itemId}`);
        await queryClient.invalidateQueries({ queryKey: ['/api/cart'] });
      }
      toast({
        title: "Item removed",
        description: "Item has been removed from your cart",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to remove item",
        variant: "destructive",
      });
    }
  };

  const handleCheckout = () => {
    setLocation("/cart-checkout");
  };

  if (isLoading) {
    return (
      <div className="container mx-auto py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
          <div className="text-center py-12">Loading cart...</div>
        </div>
      </div>
    );
  }

  if (!hasItems) {
    return (
      <div className="container mx-auto py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
          <Card>
            <CardContent className="py-12 text-center">
              <ShoppingCart className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
              <h2 className="text-xl font-semibold mb-2">Your cart is empty</h2>
              <p className="text-muted-foreground mb-6">
                Add some products to get started
              </p>
              <Button onClick={() => setLocation("/shop")} data-testid="button-continue-shopping">
                Browse Products
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">Shopping Cart</h1>
        
        <div className="space-y-6">
          {/* Cart Items */}
          <Card>
            <CardHeader>
              <CardTitle>Cart Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {items.map(cartItem => {
                if (cartItem.type === 'legacy') {
                  const item = cartItem.item;
                  const basePrice = item.isSubscription ? 54.00 : 60.00;
                  const itemTotal = basePrice * item.quantity;
                  const frequencyLabel = item.subscriptionFrequency === 'weekly' ? 'Weekly' :
                    item.subscriptionFrequency === 'bi-weekly' ? 'Bi-weekly' : 'Every 4 Weeks';

                  return (
                    <div key={item.id} className="flex items-center justify-between py-4 border-b last:border-0" data-testid={`cart-item-${item.id}`}>
                      <div className="flex items-center gap-4 flex-1">
                        <img 
                          src={item.product.imageUrl} 
                          alt={item.product.name}
                          className="w-20 h-20 object-cover rounded"
                        />
                        <div className="flex-1">
                          <h3 className="font-semibold">{item.product.name} - Case of 12</h3>
                          {item.isSubscription && (
                            <p className="text-sm text-muted-foreground">{frequencyLabel} Subscription</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleUpdateQuantity(item.id, item.quantity - 1, false)}
                              disabled={item.quantity <= 1}
                              data-testid={`button-decrease-quantity-${item.id}`}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm font-medium w-8 text-center" data-testid={`quantity-${item.id}`}>
                              {item.quantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleUpdateQuantity(item.id, item.quantity + 1, false)}
                              data-testid={`button-increase-quantity-${item.id}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-semibold" data-testid={`item-total-${item.id}`}>
                          ${itemTotal.toFixed(2)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.id, false)}
                          data-testid={`button-remove-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                } else {
                  const item = cartItem.item;
                  const basePrice = parseFloat(item.retailProduct.price);
                  const discountPercentage = item.isSubscription 
                    ? parseFloat(item.retailProduct.subscriptionDiscount) 
                    : 0;
                  const finalPrice = item.isSubscription && discountPercentage > 0
                    ? basePrice * (1 - discountPercentage / 100)
                    : basePrice;
                  const itemTotal = finalPrice * item.quantity;
                  const frequencyLabel = item.subscriptionFrequency === 'weekly' ? 'Weekly' :
                    item.subscriptionFrequency === 'bi-weekly' ? 'Bi-weekly' : 'Every 4 Weeks';

                  const imageUrl = item.retailProduct.flavor.primaryImageUrl?.startsWith('http')
                    ? item.retailProduct.flavor.primaryImageUrl
                    : item.retailProduct.flavor.primaryImageUrl
                      ? `/public/${item.retailProduct.flavor.primaryImageUrl}`
                      : undefined;

                  return (
                    <div key={item.id} className="flex items-center justify-between py-4 border-b last:border-0" data-testid={`cart-item-${item.id}`}>
                      <div className="flex items-center gap-4 flex-1">
                        {imageUrl && (
                          <img 
                            src={imageUrl} 
                            alt={item.retailProduct.flavor.name}
                            className="w-20 h-20 object-cover rounded"
                          />
                        )}
                        <div className="flex-1">
                          <h3 className="font-semibold">
                            {item.retailProduct.flavor.name} {item.retailProduct.unitDescription}
                          </h3>
                          {item.isSubscription && (
                            <p className="text-sm text-muted-foreground">
                              {frequencyLabel} Subscription
                              {discountPercentage > 0 && ` (${discountPercentage}% off)`}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleUpdateQuantity(item.id, item.quantity - 1, true)}
                              disabled={item.quantity <= 1}
                              data-testid={`button-decrease-quantity-${item.id}`}
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="text-sm font-medium w-8 text-center" data-testid={`quantity-${item.id}`}>
                              {item.quantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleUpdateQuantity(item.id, item.quantity + 1, true)}
                              data-testid={`button-increase-quantity-${item.id}`}
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-semibold" data-testid={`item-total-${item.id}`}>
                          ${itemTotal.toFixed(2)}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveItem(item.id, true)}
                          data-testid={`button-remove-${item.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                }
              })}
            </CardContent>
          </Card>

          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span data-testid="cart-subtotal">${subtotal}</span>
              </div>
              {parseFloat(depositTotal) > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Deposit</span>
                  <span data-testid="cart-deposit">${depositTotal}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (10.35%)</span>
                <span data-testid="cart-tax">${taxAmount}</span>
              </div>
              <div className="border-t pt-2 flex justify-between font-semibold text-lg">
                <span>Total</span>
                <span data-testid="cart-total">${total}</span>
              </div>
            </CardContent>
            <CardFooter className="flex gap-3">
              <Button 
                variant="outline" 
                onClick={() => setLocation("/shop")}
                data-testid="button-continue-shopping"
              >
                Continue Shopping
              </Button>
              <Button 
                className="flex-1"
                onClick={handleCheckout}
                data-testid="button-checkout"
              >
                Proceed to Checkout
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
