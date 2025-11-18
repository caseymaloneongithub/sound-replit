import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useStripe, Elements, PaymentElement, useElements } from '@stripe/react-stripe-js';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useUnifiedCart } from "@/hooks/use-unified-cart";

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

interface PaymentIntentResponse {
  clientSecret: string;
  subtotal: number;
  taxAmount: number;
  total: number;
}

function CheckoutForm({ paymentInfo }: { paymentInfo: PaymentIntentResponse }) {
  const stripe = useStripe();
  const elements = useElements();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isProcessing, setIsProcessing] = useState(false);
  const [customerInfo, setCustomerInfo] = useState<CustomerForm | null>(null);
  const [step, setStep] = useState<'info' | 'payment'>('info');

  const form = useForm<CustomerForm>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      customerName: "",
      customerEmail: "",
      customerPhone: "",
    },
  });

  const handleCustomerInfo = async (data: CustomerForm) => {
    try {
      // Extract payment intent ID from client secret
      const paymentIntentId = paymentInfo.clientSecret.split('_secret_')[0];
      
      // Store customer info on the server
      await apiRequest("POST", "/api/checkout/customer-info", {
        customerName: data.customerName,
        customerEmail: data.customerEmail,
        customerPhone: data.customerPhone,
        paymentIntentId,
      });
      
      setCustomerInfo(data);
      setStep('payment');
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save customer information",
        variant: "destructive",
      });
    }
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
          return_url: `${window.location.origin}/checkout/success`,
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
        // Clear both cart query caches
        queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
        queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
        
        setLocation('/checkout/success');
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
        <Button type="submit" className="w-full" data-testid="button-continue-to-payment">
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
        className="w-full" 
        disabled={!stripe || isProcessing}
        data-testid="button-complete-purchase"
      >
        {isProcessing ? 'Processing...' : `Pay $${paymentInfo.total.toFixed(2)}`}
      </Button>
    </form>
  );
}

export default function CartCheckout() {
  const [clientSecret, setClientSecret] = useState("");
  const [paymentInfo, setPaymentInfo] = useState<PaymentIntentResponse | null>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { items: unifiedCart, isLoading, totalCount } = useUnifiedCart();

  useEffect(() => {
    if (isLoading) return;

    if (totalCount === 0) {
      toast({
        title: "Cart is empty",
        description: "Add items to your cart before checking out",
      });
      setLocation('/shop');
      return;
    }

    if (!STRIPE_PUBLIC_KEY) {
      return;
    }

    apiRequest("POST", "/api/create-cart-payment-intent", {})
      .then((data) => {
        if (!data.clientSecret) {
          throw new Error(data.message || "No client secret received");
        }
        setClientSecret(data.clientSecret);
        setPaymentInfo({
          clientSecret: data.clientSecret,
          subtotal: data.subtotal,
          taxAmount: data.taxAmount,
          total: data.total,
        });
      })
      .catch((error) => {
        toast({
          title: "Error",
          description: error.message || "Failed to initialize checkout",
          variant: "destructive",
        });
        setLocation('/shop');
      });
  }, [totalCount, isLoading, setLocation, toast]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!STRIPE_PUBLIC_KEY) {
    return (
      <div className="min-h-screen bg-background py-12 px-6">
        <div className="max-w-2xl mx-auto">
          <Card className="border-destructive">
            <CardHeader>
              <CardTitle className="text-destructive">Payment System Not Configured</CardTitle>
              <CardDescription>
                Payment processing is currently unavailable. Please contact support.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setLocation('/shop')} variant="outline" className="w-full">
                Back to Shop
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!clientSecret || !paymentInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Calculate subtotal from unified cart (for display only, server calculates actual)
  const subtotal = unifiedCart.reduce((sum, cartItem) => {
    try {
      if (cartItem.type === 'legacy') {
        const priceStr = cartItem.item.product?.retailPrice;
        if (!priceStr) return sum;
        const pricePerCase = parseFloat(priceStr);
        if (!isFinite(pricePerCase) || pricePerCase < 0) return sum;
        return sum + (pricePerCase * cartItem.item.quantity);
      } else {
        const priceStr = cartItem.item.retailProduct?.price;
        if (!priceStr) return sum;
        const pricePerUnit = parseFloat(priceStr);
        if (!isFinite(pricePerUnit) || pricePerUnit < 0) return sum;
        return sum + (pricePerUnit * cartItem.item.quantity);
      }
    } catch (e) {
      console.error("Error calculating cart item price:", e, cartItem);
      return sum;
    }
  }, 0);

  return (
    <div className="min-h-screen bg-background py-12 px-6">
      <div className="max-w-5xl mx-auto">
        <Button
          variant="ghost"
          className="mb-6 gap-2"
          onClick={() => setLocation('/shop')}
          data-testid="button-back-to-shop"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Shop
        </Button>

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Order Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Order Summary</CardTitle>
              <CardDescription>
                {totalCount} {totalCount === 1 ? 'item' : 'items'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {unifiedCart.map((cartItem) => {
                if (cartItem.type === 'legacy') {
                  const item = cartItem.item;
                  const price = item.product.retailPrice ? parseFloat(item.product.retailPrice) : 0;
                  const validPrice = Number.isFinite(price) && price >= 0 ? price : 0;
                  const itemTotal = validPrice * item.quantity;
                  
                  return (
                    <div key={item.id} className="flex gap-4" data-testid={`summary-item-${item.id}`}>
                      <img
                        src={item.product.imageUrl}
                        alt={item.product.name}
                        className="w-16 h-16 object-cover rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{item.product.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} {item.quantity === 1 ? 'case' : 'cases'} × ${validPrice.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          ${itemTotal.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                } else {
                  const item = cartItem.item;
                  const price = item.retailProduct.price ? parseFloat(item.retailProduct.price) : 0;
                  const validPrice = Number.isFinite(price) && price >= 0 ? price : 0;
                  const itemTotal = validPrice * item.quantity;
                  
                  return (
                    <div key={item.id} className="flex gap-4" data-testid={`summary-item-${item.id}`}>
                      <div className="w-16 h-16 overflow-hidden rounded">
                        {item.retailProduct.flavor.primaryImageUrl ? (
                          <img
                            src={item.retailProduct.flavor.primaryImageUrl}
                            alt={item.retailProduct.flavor.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                            No image
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium truncate">{item.retailProduct.flavor.name}</h4>
                        <p className="text-sm text-muted-foreground">
                          {item.quantity} × ${validPrice.toFixed(2)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {item.retailProduct.unitDescription}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">
                          ${itemTotal.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  );
                }
              })}

              <div className="border-t pt-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span data-testid="text-summary-subtotal">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Sales Tax (10.35%)</span>
                  <span data-testid="text-summary-tax">${paymentInfo.taxAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold pt-2 border-t">
                  <span>Total</span>
                  <span data-testid="text-summary-total">${paymentInfo.total.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Payment Form */}
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">Payment</CardTitle>
              <CardDescription>
                Enter your information and payment details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Elements stripe={stripePromise} options={{ clientSecret }}>
                <CheckoutForm paymentInfo={paymentInfo} />
              </Elements>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
