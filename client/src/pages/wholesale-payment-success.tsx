import { useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

export default function WholesalePaymentSuccess() {
  const [, params] = useRoute("/wholesale/invoice/:id/payment-success");
  const [, setLocation] = useLocation();
  const orderId = params?.id;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <CheckCircle2 className="w-16 h-16 text-green-500" />
          </div>
          <CardTitle className="text-2xl">Payment Successful!</CardTitle>
          <CardDescription>
            Your payment has been processed successfully
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Thank you for your payment. You will receive a confirmation email shortly.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => setLocation(`/wholesale/invoice/${orderId}`)}
              data-testid="button-view-invoice"
            >
              View Invoice
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation("/wholesale/orders")}
              data-testid="button-back-to-orders"
            >
              Back to Orders
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
