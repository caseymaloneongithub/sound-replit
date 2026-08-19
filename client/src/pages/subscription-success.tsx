import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SubscriptionSuccess() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center pb-6">
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
              <li>• Your card is charged on the Monday of each pickup week</li>
              <li>• Skip a delivery, pause, or cancel anytime from your account</li>
            </ul>
          </div>
          {/* Primary action now points at the subscription they just created — both
              buttons used to lead away from it, with no way to see what they'd bought. */}
          <div className="flex flex-col gap-3">
            <Button
              className="w-full rounded-full"
              onClick={() => window.location.href = '/my-account'}
              data-testid="button-view-subscription"
            >
              View my subscription
            </Button>
            <Button
              variant="outline"
              className="w-full rounded-full"
              onClick={() => window.location.href = '/shop'}
              data-testid="button-back-to-shop"
            >
              Continue Shopping
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
