import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Trash2, Plus, Minus, Loader2, Repeat } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getCasePrice, formatCaseQuantity } from "@shared/pricing";

interface CartItemWithProduct {
  id: string;
  productId: string;
  quantity: number;
  isSubscription: boolean;
  subscriptionFrequency?: string | null;
  product: {
    id: string;
    name: string;
    retailPrice: string;
    imageUrl: string;
  };
}

export function CartDrawer() {
  const [open, setOpen] = useState(false);
  const [isProcessingCheckout, setIsProcessingCheckout] = useState(false);
  const { toast } = useToast();

  const { data: cartItems = [], isLoading } = useQuery<CartItemWithProduct[]>({
    queryKey: ["/api/cart"],
  });

  const updateQuantityMutation = useMutation({
    mutationFn: async ({ id, quantity }: { id: string; quantity: number }) => {
      await apiRequest("PATCH", `/api/cart/${id}`, { quantity });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
    },
  });

  const removeItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      await apiRequest("DELETE", `/api/cart/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      toast({
        title: "Removed from cart",
        description: "Item removed successfully",
      });
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/create-cart-checkout");
    },
    onSuccess: (data: any) => {
      if (data && data.url) {
        window.location.href = data.url;
      } else {
        setIsProcessingCheckout(false);
        toast({
          title: "Checkout Error",
          description: "No checkout URL received",
          variant: "destructive",
        });
      }
    },
    onError: (error: any) => {
      setIsProcessingCheckout(false);
      toast({
        title: "Checkout Error",
        description: error.message || "Failed to create checkout session",
        variant: "destructive",
      });
    },
  });

  const handleCheckout = () => {
    setIsProcessingCheckout(true);
    checkoutMutation.mutate();
  };

  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  
  // Calculate subtotal for all items using actual product prices
  const subtotal = cartItems.reduce((sum, item) => {
    const pricePerCase = parseFloat(item.product.retailPrice);
    return sum + (pricePerCase * item.quantity);
  }, 0);
  
  // Calculate taxable subtotal (only non-subscription items), using actual product prices
  const taxableSubtotal = cartItems
    .filter(item => !item.isSubscription)
    .reduce((sum, item) => {
      // Use actual product retail price from the cart item
      const pricePerCase = parseFloat(item.product.retailPrice);
      return sum + (pricePerCase * item.quantity);
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
          ) : cartItems.length === 0 ? (
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
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="flex gap-4 p-4 rounded-lg border"
                  data-testid={`cart-item-${item.id}`}
                >
                  <img
                    src={item.product.imageUrl}
                    alt={item.product.name}
                    className="w-20 h-20 object-cover rounded"
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold truncate" data-testid={`text-item-name-${item.id}`}>
                      {item.product.name}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium" data-testid={`text-item-quantity-${item.id}`}>
                        {formatCaseQuantity(item.quantity)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <p className="text-sm text-muted-foreground" data-testid={`text-item-price-${item.id}`}>
                        ${parseFloat(item.product.retailPrice).toFixed(2)} per case
                      </p>
                      {item.isSubscription && (
                        <Badge variant="secondary" className="gap-1 text-xs">
                          <Repeat className="w-3 h-3" />
                          {item.subscriptionFrequency === 'weekly' ? 'Weekly' : 'Bi-Weekly'}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2">
                      <div className="flex items-center gap-1 bg-muted rounded-full">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() =>
                            updateQuantityMutation.mutate({
                              id: item.id,
                              quantity: Math.max(1, item.quantity - 1),
                            })
                          }
                          disabled={item.quantity <= 1 || updateQuantityMutation.isPending}
                          data-testid={`button-decrease-${item.id}`}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="text-sm font-medium px-3 min-w-12 text-center" data-testid={`text-quantity-${item.id}`}>
                          {item.quantity}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full"
                          onClick={() =>
                            updateQuantityMutation.mutate({
                              id: item.id,
                              quantity: item.quantity + 1,
                            })
                          }
                          disabled={updateQuantityMutation.isPending}
                          data-testid={`button-increase-${item.id}`}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeItemMutation.mutate(item.id)}
                        data-testid={`button-remove-${item.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-bold" data-testid={`text-item-total-${item.id}`}>
                      ${(parseFloat(item.product.retailPrice) * item.quantity).toFixed(2)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cartItems.length > 0 && (
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
              
              {taxableSubtotal === 0 && cartItems.length > 0 && (
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
              disabled={isProcessingCheckout}
              data-testid="button-checkout"
            >
              {isProcessingCheckout ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                "Proceed to Checkout"
              )}
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
