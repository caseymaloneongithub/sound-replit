import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUnifiedCart } from "@/hooks/use-unified-cart";
import { UnifiedCartItemComponent } from "./unified-cart-item";
import { useAuth } from "@/hooks/use-auth";

export function CartDrawer() {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const { items: unifiedItems, isLoading } = useUnifiedCart();

  const updateQuantityMutation = useMutation({
    mutationFn: async ({ id, quantity, type }: { id: string; quantity: number; type: 'legacy' | 'retail_v2' }) => {
      if (type === 'legacy') {
        await apiRequest("PATCH", `/api/cart/${id}`, { quantity });
      } else {
        await apiRequest("PATCH", `/api/retail-cart/${id}`, { quantity });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async ({ itemId, type }: { itemId: string; type: 'legacy' | 'retail_v2' }) => {
      if (type === 'legacy') {
        await apiRequest("DELETE", `/api/cart/${itemId}`);
      } else {
        await apiRequest("DELETE", `/api/retail-cart/${itemId}`);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
      toast({
        title: "Removed from cart",
        description: "Item removed successfully",
      });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const hasSubscription = unifiedItems.some(item => item.item.isSubscription);
      const hasOneTime = unifiedItems.some(item => !item.item.isSubscription);

      // Check for mixed cart (not allowed)
      if (hasSubscription && hasOneTime) {
        throw new Error("Please checkout one-time purchases and subscriptions separately. Remove either type from your cart to continue.");
      }

      // For subscription-only carts, use Stripe Checkout Session
      if (hasSubscription) {
        const response = await apiRequest("POST", "/api/create-cart-checkout", {});
        return { type: 'subscription', url: response.url };
      }

      // For one-time purchases, navigate to embedded checkout
      return { type: 'one-time' };
    },
    onSuccess: (data) => {
      setOpen(false);
      if (data.type === 'subscription' && data.url) {
        // Redirect to Stripe Checkout for subscriptions
        window.location.href = data.url;
      } else {
        // Navigate to embedded checkout for one-time purchases
        setLocation('/cart-checkout');
      }
    },
    onError: (error: any) => {
      toast({
        title: "Checkout Error",
        description: error.message || "Unable to proceed with checkout",
        variant: "destructive",
      });
    },
  });

  const handleCheckout = () => {
    // Check if cart has subscriptions
    const hasSubscription = unifiedItems.some(item => item.item.isSubscription);
    
    // Require authentication for subscriptions
    if (hasSubscription && !user) {
      setOpen(false);
      setLocation('/auth?redirect=/shop');
      toast({
        title: "Account Required",
        description: "Please sign in or create an account to subscribe",
      });
      return;
    }
    
    checkoutMutation.mutate();
  };

  const cartCount = unifiedItems.reduce((sum, item) => {
    return sum + (item.type === 'legacy' ? item.item.quantity : item.item.quantity);
  }, 0);
  
  // Helper function to calculate price per case (with subscription discount if applicable)
  const getPricePerCase = (unifiedItem: typeof unifiedItems[0]) => {
    const basePrice = unifiedItem.type === 'legacy'
      ? parseFloat(unifiedItem.item.product.retailPrice)
      : parseFloat(unifiedItem.item.retailProduct.price);
    
    const isSubscription = unifiedItem.item.isSubscription;
    const subscriptionDiscountPercentage = unifiedItem.type === 'retail_v2'
      ? parseFloat(unifiedItem.item.retailProduct.subscriptionDiscount)
      : 0;
    
    return isSubscription && subscriptionDiscountPercentage > 0
      ? basePrice * (1 - subscriptionDiscountPercentage / 100)
      : basePrice;
  };
  
  // Calculate subtotal for all items using discounted prices where applicable
  const subtotal = unifiedItems.reduce((sum, item) => {
    const pricePerCase = getPricePerCase(item);
    return sum + (pricePerCase * item.item.quantity);
  }, 0);
  
  // Calculate taxable subtotal (only non-subscription items), using discounted prices
  const taxableSubtotal = unifiedItems
    .filter(item => !item.item.isSubscription)
    .reduce((sum, item) => {
      const pricePerCase = getPricePerCase(item);
      return sum + (pricePerCase * item.item.quantity);
    }, 0);
  
  // Calculate sales tax (WA State 6.5% + Seattle 3.85% = 10.35%)
  // Tax only applies to one-time purchases, not subscriptions
  const TAX_RATE = 0.1035;
  const taxAmount = taxableSubtotal * TAX_RATE;
  const cartTotal = subtotal + taxAmount;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="button-cart">
          <ShoppingCart className="w-5 h-5" />
          {cartCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 min-w-5 flex items-center justify-center p-0 text-xs"
              data-testid="badge-cart-count"
            >
              {cartCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Shopping Cart</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-4 animate-pulse">
                  <div className="w-20 h-20 bg-muted rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted rounded w-3/4" />
                    <div className="h-3 bg-muted rounded w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : unifiedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <ShoppingCart className="w-16 h-16 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">Your cart is empty</h3>
              <p className="text-sm text-muted-foreground mb-6">
                Add some kombucha to get started!
              </p>
              <Button onClick={() => setOpen(false)} data-testid="button-continue-shopping">
                Continue Shopping
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {unifiedItems.map((unifiedItem) => (
                <UnifiedCartItemComponent
                  key={unifiedItem.item.id}
                  unifiedItem={unifiedItem}
                  onUpdateQuantity={(id, quantity, type) => 
                    updateQuantityMutation.mutate({ id, quantity, type })
                  }
                  onRemove={(id, type) => 
                    removeItemMutation.mutate({ itemId: id, type })
                  }
                  isUpdating={updateQuantityMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>

        {unifiedItems.length > 0 && (
          <div className="border-t pt-6 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span data-testid="text-cart-subtotal">${subtotal.toFixed(2)}</span>
              </div>
              
              {taxAmount > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Sales Tax (10.35%)</span>
                  <span data-testid="text-cart-tax">${taxAmount.toFixed(2)}</span>
                </div>
              )}
              
              {taxableSubtotal === 0 && unifiedItems.length > 0 && (
                <div className="text-xs text-muted-foreground">
                  * Subscriptions are not subject to sales tax
                </div>
              )}
              
              <div className="flex items-center justify-between text-lg font-bold pt-2 border-t">
                <span>Total</span>
                <span data-testid="text-cart-total">${cartTotal.toFixed(2)}</span>
              </div>
            </div>
            
            <Button
              className="w-full rounded-full"
              size="lg"
              onClick={handleCheckout}
              disabled={checkoutMutation.isPending}
              data-testid="button-checkout"
            >
              {checkoutMutation.isPending ? "Processing..." : "Proceed to Checkout"}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
