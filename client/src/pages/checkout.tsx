import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useStripe, Elements, PaymentElement, useElements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { SubscriptionPlan } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, CheckCircle2, AlertCircle } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY;
const stripePromise: Promise<Stripe | null> = STRIPE_PUBLIC_KEY 
  ? loadStripe(STRIPE_PUBLIC_KEY)
  : Promise.resolve(null);

const customerSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Invalid email address"),
  customerPhone: z.string().min(10, "Phone number must be at least 10 digits"),
});

type CustomerForm = z.infer<typeof customerSchema>;

function CheckoutForm({ planId, plan }: { planId: string; plan?: SubscriptionPlan }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerForm | null>(null);
  const [step, setStep] = useState<'info' | 'payment'>(customerInfo ? 'payment' : 'info');

  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customerName: "",
      customerEmail: "",
      customerPhone: "",
    },
  });

  const handleCustomerInfo = (data: CustomerForm) => {
    setCustomerInfo(data);
    setStep('payment');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements || !customerInfo) {
      return;
    }

    setIsProcessing(true);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/subscription-success`,
          receipt_email: customerInfo.customerEmail,
        },
        redirect: 'if_required',
      });

      if (error) {
        toast({
          title: "Payment Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        await apiRequest("POST", "/api/subscriptions", {
          ...customerInfo,
          planId,
        });
        
        setLocation('/subscription-success');
      }
    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (step === 'info') {
    return (
      <form onSubmit={form.handleSubmit(handleCustomerInfo)} className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="customerName">Full Name</Label>
            <Input
              id="customerName"
              {...form.register("customerName")}
             
              data-testid="input-customer-name"
            />
            {form.formState.errors.customerName && (
              <p className="text-sm text-destructive">{form.formState.errors.customerName.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerEmail">Email</Label>
            <Input
              id="customerEmail"
              type="email"
              {...form.register("customerEmail")}
             
              data-testid="input-customer-email"
            />
            {form.formState.errors.customerEmail && (
              <p className="text-sm text-destructive">{form.formState.errors.customerEmail.message}</p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerPhone">Phone Number</Label>
            <Input
              id="customerPhone"
              type="tel"
              {...form.register("customerPhone")}
             
              data-testid="input-customer-phone"
            />
            {form.formState.errors.customerPhone && (
              <p className="text-sm text-destructive">{form.formState.errors.customerPhone.message}</p>
            )}
          </div>
        </div>
        <Button type="submit" className="w-full rounded-full" data-testid="button-continue-to-payment">
          Continue to Payment
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-4">
        <div className="p-4 bg-muted rounded-lg">
          <p className="text-sm font-medium mb-1">Customer Information</p>
          <p className="text-sm text-muted-foreground">{customerInfo?.customerName}</p>
          <p className="text-sm text-muted-foreground">{customerInfo?.customerEmail}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="p-0 h-auto mt-2"
            onClick={() => setStep('info')}
            data-testid="button-edit-info"
          >
            Edit Information
          </Button>
        </div>
        <PaymentElement />
      </div>
      <Button 
        type="submit" 
        className="w-full rounded-full" 
        disabled={!stripe || isProcessing}
        data-testid="button-complete-subscription"
      >
        {isProcessing ? 'Processing...' : `Subscribe for $${plan?.price}/${plan?.frequency === 'weekly' ? 'week' : 'month'}`}
      </Button>
    </form>
  );
}

export default function Checkout() {
  const [clientSecret, setClientSecret] = useState("");
  const searchParams = new URLSearchParams(window.location.search);
  const planId = searchParams.get('planId');
  const [, setLocation] = useLocation();

  const { data: plan } = useQuery<SubscriptionPlan>({
    queryKey: [`/api/subscription-plans/${planId}`],
    enabled: !!planId,
  });

  useEffect(() => {
    if (!planId) {
      setLocation('/subscriptions');
      return;
    }

    if (!STRIPE_PUBLIC_KEY) {
      return;
    }

    apiRequest("POST", "/api/create-subscription-intent", { planId })
      .then((res) => res.json())
      .then((data) => {
        if (data.message) {
          throw new Error(data.message);
        }
        setClientSecret(data.clientSecret);
      })
      .catch(() => {
        setLocation('/subscriptions');
      });
  }, [planId, setLocation]);

  if (!STRIPE_PUBLIC_KEY) {
    return (
      <div className="min-h-screen bg-background py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <Card className="border-destructive">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <AlertCircle className="w-6 h-6 text-destructive" />
                <CardTitle className="text-destructive">Payment System Not Configured</CardTitle>
              </div>
              <CardDescription>
                Payment processing is currently unavailable. Please contact support for assistance with subscriptions.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setLocation('/subscriptions')} variant="outline" className="w-full">
                Back to Plans
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!clientSecret || !plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" aria-label="Loading"/>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <Button
          variant="ghost"
          className="mb-6 gap-2"
          onClick={() => setLocation('/subscriptions')}
          data-testid="button-back-to-plans"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Plans
        </Button>

        <div className="grid gap-8">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl" style={{ fontFamily: 'var(--font-heading)' }}>
                Subscribe to {plan.name}
              </CardTitle>
              <CardDescription>
                {plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1)} delivery • {plan.bottleCount} bottles
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex justify-between items-baseline mb-6 p-4 bg-muted rounded-lg">
                <span className="font-medium">Total</span>
                <div className="text-right">
                  <div className="text-3xl font-bold">${plan.price}</div>
                  <div className="text-sm text-muted-foreground">per {plan.frequency === 'weekly' ? 'week' : 'month'}</div>
                </div>
              </div>

              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutForm planId={planId!} plan={plan} />
              </Elements>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
