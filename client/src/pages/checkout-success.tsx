import { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  const paymentIntentId = params.get("payment_intent");
  
  // Determine if this is a subscription or one-time purchase
  const isSubscription = !!sessionId;

  useEffect(() => {
    // Require either session_id or payment_intent
    if (!sessionId && !paymentIntentId) {
      navigate("/shop");
      return;
    }
    
    // Clear cart caches when we land on success page
    queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
    queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
  }, [sessionId, paymentIntentId, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <Card className="max-w-md w-full" data-testid="card-success">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-16 h-16 text-green-500" data-testid="icon-success" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-success-title">
            {isSubscription ? "Subscription Activated!" : "Order Confirmed!"}
          </CardTitle>
          <CardDescription data-testid="text-success-description">
            Thank you for your {isSubscription ? "subscription to" : "purchase from"} Puget Sound Kombucha Co.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm text-muted-foreground" data-testid="text-success-message">
              {isSubscription 
                ? "You'll receive a confirmation email shortly with details about your subscription. Your first pickup will be ready within the next week."
                : "You'll receive a confirmation email shortly with your order details and pickup information."}
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => navigate("/my-orders")}
              className="flex-1"
              data-testid="button-view-orders"
            >
              View My Orders
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/shop")}
              className="flex-1"
              data-testid="button-continue-shopping"
            >
              Continue Shopping
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
