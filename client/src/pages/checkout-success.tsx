import { useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export default function CheckoutSuccess() {
  const [, navigate] = useLocation();
  const sessionId = new URLSearchParams(window.location.search).get("session_id");

  useEffect(() => {
    if (!sessionId) {
      navigate("/shop");
    }
  }, [sessionId, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-background">
      <Card className="max-w-md w-full" data-testid="card-success">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-16 h-16 text-green-500" data-testid="icon-success" />
          </div>
          <CardTitle className="text-2xl" data-testid="text-success-title">
            Subscription Activated!
          </CardTitle>
          <CardDescription data-testid="text-success-description">
            Thank you for subscribing to Puget Sound Kombucha Co.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg">
            <p className="text-sm text-muted-foreground" data-testid="text-success-message">
              You'll receive a confirmation email shortly with details about your subscription. 
              Your first delivery will be ready for pickup within the next week.
            </p>
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => navigate("/account")}
              className="flex-1"
              data-testid="button-view-account"
            >
              View My Account
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
