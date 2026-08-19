import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * Landing page after authorising a bank payment.
 *
 * Wholesale pays by ACH, which is NOT instant — the customer authorises a debit here and
 * the funds take several business days to clear, and can still be returned. This page
 * therefore confirms the payment was *submitted*, not that it succeeded. Saying "Payment
 * successful!" would have customers believing an invoice is settled days before the money
 * moves, and leave them misinformed if the debit later bounces. The invoice only flips to
 * Paid when Stripe confirms settlement.
 */
export default function WholesalePaymentSuccess() {
  const [, staffParams] = useRoute("/wholesale/invoice/:id/payment-success");
  const [, customerParams] = useRoute("/wholesale-customer/invoice/:id/payment-success");
  const [, setLocation] = useLocation();
  const orderId = staffParams?.id ?? customerParams?.id;
  const isCustomer = !!customerParams?.id;

  const invoicePath = isCustomer
    ? `/wholesale-customer/invoice/${orderId}`
    : `/wholesale/invoice/${orderId}`;
  const ordersPath = isCustomer ? "/wholesale-customer/orders" : "/wholesale/orders";

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">Payment submitted</CardTitle>
          <CardDescription>
            Your bank transfer is on its way
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            Bank transfers usually take 4&ndash;5 business days to clear. Your invoice will
            show as <span className="font-medium text-foreground">Payment processing</span>{" "}
            until then, and we'll email you a receipt once the funds arrive.
          </p>
          <p className="text-sm text-muted-foreground text-center">
            There's nothing else you need to do &mdash; please don't pay again.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              onClick={() => setLocation(invoicePath)}
              data-testid="button-view-invoice"
            >
              View Invoice
            </Button>
            <Button
              variant="outline"
              onClick={() => setLocation(ordersPath)}
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
