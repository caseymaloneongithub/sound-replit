import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2 } from "lucide-react";

export default function SubscriptionSuccess() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center pb-6">
          <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-primary-foreground" />
          </div>
          <CardTitle className="text-3xl" style={{ fontFamily: 'var(--font-heading)' }}>
            Subscription Confirmed!
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Thank you for subscribing to our kombucha subscription service
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3 p-4 bg-muted rounded-lg">
            <p className="text-sm">
              <strong className="text-foreground">What's Next?</strong>
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• You'll receive a confirmation email shortly</li>
              <li>• We'll send you pickup details before your first pickup</li>
              <li>• You can manage your subscription anytime</li>
            </ul>
          </div>
          <div className="flex flex-col gap-3">
            <Button 
              className="w-full rounded-full"
              onClick={() => window.location.href = '/shop'}
              data-testid="button-back-to-shop"
            >
              Continue Shopping
            </Button>
            <Button 
              variant="outline"
              className="w-full rounded-full"
              onClick={() => window.location.href = '/'}
              data-testid="button-home"
            >
              Back to Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
