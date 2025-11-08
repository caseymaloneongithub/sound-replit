import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, ArrowLeft } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { SubscriptionPlan } from "@shared/schema";

const checkoutFormSchema = z.object({
  customerName: z.string().min(2, "Name must be at least 2 characters"),
  customerEmail: z.string().email("Please enter a valid email"),
});

type CheckoutFormValues = z.infer<typeof checkoutFormSchema>;

export default function Subscribe() {
  const { id: planId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: plan, isLoading } = useQuery<SubscriptionPlan>({
    queryKey: ["/api/subscription-plans", planId],
  });

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: {
      customerName: "",
      customerEmail: "",
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: async (data: CheckoutFormValues) => {
      const response = await apiRequest("POST", "/api/create-checkout-session", {
        planId,
        customerName: data.customerName,
        customerEmail: data.customerEmail,
      });
      return await response.json();
    },
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to create checkout session",
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: CheckoutFormValues) => {
    setIsProcessing(true);
    checkoutMutation.mutate(data);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="loader-plan" />
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-4">Plan not found</h2>
          <Button onClick={() => navigate("/shop")} data-testid="button-back-to-shop">
            Back to Shop
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen py-12 px-4 bg-background">
      <div className="max-w-4xl mx-auto">
        <Button
          variant="ghost"
          onClick={() => navigate("/shop")}
          className="mb-6"
          data-testid="button-back"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Shop
        </Button>

        <div className="grid md:grid-cols-2 gap-8">
          <Card data-testid="card-plan-details">
            <CardHeader>
              <CardTitle data-testid="text-plan-name">{plan.name}</CardTitle>
              <CardDescription data-testid="text-plan-frequency">
                {plan.frequency.charAt(0).toUpperCase() + plan.frequency.slice(1)} subscription
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-4xl font-bold" data-testid="text-plan-price">
                  ${plan.price}
                  <span className="text-lg font-normal text-muted-foreground">/{plan.frequency}</span>
                </div>
                <p className="text-muted-foreground mt-1" data-testid="text-plan-bottles">
                  {plan.bottleCount} bottles per {plan.frequency}
                </p>
              </div>

              {plan.savings && (
                <Badge variant="default" className="bg-primary" data-testid="badge-savings">
                  {plan.savings}
                </Badge>
              )}

              <div className="space-y-2 pt-4">
                <h4 className="font-semibold mb-3">What's included:</h4>
                {plan.benefits.map((benefit, idx) => (
                  <div key={idx} className="flex items-start gap-2" data-testid={`benefit-${idx}`}>
                    <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-sm">{benefit}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-checkout-form">
            <CardHeader>
              <CardTitle>Subscription Details</CardTitle>
              <CardDescription>
                Enter your information to start your subscription
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="customerName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Full Name</FormLabel>
                        <FormControl>
                          <Input
                           
                            {...field}
                            data-testid="input-customer-name"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="customerEmail"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                           
                            {...field}
                            data-testid="input-customer-email"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="bg-muted p-4 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      You'll be redirected to Stripe to complete your payment securely. 
                      Your subscription will begin immediately after payment confirmation.
                    </p>
                  </div>

                  <Button
                    type="submit"
                    className="w-full"
                    disabled={isProcessing}
                    data-testid="button-checkout"
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Processing...
                      </>
                    ) : (
                      "Proceed to Payment"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
