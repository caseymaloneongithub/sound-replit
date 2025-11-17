import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Navbar } from "@/components/layout/navbar";
import { Loader2, ArrowLeft, Repeat, Check } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import type { Product } from "@shared/schema";

// Extend Product type to include pricing from product_types
type ProductWithPricing = Product & {
  retailPrice: string;
  wholesalePrice: string;
};

type FrequencyOption = 'weekly' | 'bi-weekly' | 'every-4-weeks';

const frequencyLabels: Record<FrequencyOption, string> = {
  'weekly': 'Every Week',
  'bi-weekly': 'Every 2 Weeks',
  'every-4-weeks': 'Every 4 Weeks',
};

export default function ProductSubscribe() {
  const { id: productId } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  
  const [frequency, setFrequency] = useState<FrequencyOption>('bi-weekly');
  const [quantity, setQuantity] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: product, isLoading } = useQuery<ProductWithPricing>({
    queryKey: ['/api/products', productId],
  });

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error('Product not found');
      
      const response = await apiRequest("POST", "/api/create-product-subscription", {
        productId: product.id,
        quantity,
        frequency,
      });
      return response;
    },
    onSuccess: (data: any) => {
      if (data.url) {
        // Redirect to Stripe Checkout
        window.location.href = data.url;
      } else {
        // Subscription created successfully (for existing subscriptions)
        navigate('/my-subscriptions');
        toast({
          title: "Subscription Created",
          description: "Your subscription has been set up successfully!",
        });
      }
    },
    onError: (error: any) => {
      setIsProcessing(false);
      toast({
        title: "Error",
        description: error.message || "Failed to create subscription",
        variant: "destructive",
      });
    },
  });

  const handleSubscribe = () => {
    if (quantity < 1) {
      toast({
        title: "Invalid Quantity",
        description: "Please select at least 1 case",
        variant: "destructive",
      });
      return;
    }
    setIsProcessing(true);
    subscribeMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="loader-product" />
        </div>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <h2 className="text-2xl font-bold mb-4">Product not found</h2>
            <Button onClick={() => navigate("/shop")} data-testid="button-back-to-shop">
              Back to Shop
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Calculate subscription price (10% discount)
  const basePrice = parseFloat(product.retailPrice);
  const subscriptionPrice = basePrice * 0.9;
  const totalPrice = subscriptionPrice * quantity;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-4xl mx-auto px-6 py-12">
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
          {/* Product Details */}
          <Card data-testid="card-product-details">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle data-testid="text-product-name">{product.name}</CardTitle>
                  <CardDescription className="mt-2">{product.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {product.imageUrl && (
                <div className="aspect-square rounded-lg overflow-hidden bg-muted">
                  <img 
                    src={product.imageUrl} 
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              
              <div className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold" data-testid="text-subscription-price">
                    ${subscriptionPrice.toFixed(2)}
                  </span>
                  <span className="text-lg text-muted-foreground line-through">
                    ${basePrice.toFixed(2)}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">per case of 12 bottles</p>
                <Badge variant="secondary" className="w-fit">
                  Save 10% with subscription
                </Badge>
              </div>

              <div className="space-y-2 pt-4 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary" />
                  <span>Pause or cancel anytime</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary" />
                  <span>Flexible delivery schedule</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary" />
                  <span>Add or remove products anytime</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Subscription Options */}
          <Card data-testid="card-subscription-options">
            <CardHeader>
              <CardTitle>Subscription Options</CardTitle>
              <CardDescription>Choose your delivery frequency and quantity</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <Label>Delivery Frequency</Label>
                <RadioGroup value={frequency} onValueChange={(value) => setFrequency(value as FrequencyOption)}>
                  {(Object.keys(frequencyLabels) as FrequencyOption[]).map((freq) => (
                    <div key={freq} className="flex items-center space-x-2">
                      <RadioGroupItem value={freq} id={freq} data-testid={`radio-${freq}`} />
                      <Label htmlFor={freq} className="cursor-pointer font-normal">
                        {frequencyLabels[freq]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>

              <div className="space-y-3">
                <Label htmlFor="quantity">Quantity (cases)</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  max="10"
                  value={quantity}
                  onChange={(e) => setQuantity(parseInt(e.target.value) || 1)}
                  data-testid="input-quantity"
                />
                <p className="text-xs text-muted-foreground">
                  {quantity} case{quantity !== 1 ? 's' : ''} = {quantity * 12} bottles
                </p>
              </div>

              <div className="pt-4 border-t space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span data-testid="text-subtotal">${totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Frequency</span>
                  <span>{frequencyLabels[frequency]}</span>
                </div>
                <div className="flex justify-between font-semibold text-lg pt-2">
                  <span>Total per delivery</span>
                  <span data-testid="text-total">${totalPrice.toFixed(2)}</span>
                </div>
              </div>

              <Button
                className="w-full gap-2"
                size="lg"
                onClick={handleSubscribe}
                disabled={isProcessing || !product.inStock}
                data-testid="button-subscribe"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Repeat className="w-4 h-4" />
                    {product.inStock ? 'Subscribe Now' : 'Out of Stock'}
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                You'll be redirected to secure checkout to complete your subscription
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
