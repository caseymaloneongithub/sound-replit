import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { RetailProduct, Flavor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/navbar";
import { ShoppingCart, Plus, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import seattleHero from "@assets/stock_images/seattle_skyline_with_db3ee238.jpg";
import logo from "@assets/text-stacked-black_1762299663824.png";

type RetailProductWithFlavor = RetailProduct & { flavor: Flavor };

export default function ShopV2() {
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<RetailProductWithFlavor[]>({
    queryKey: ["/api/retail-products"],
  });

  const addToCartMutation = useMutation({
    mutationFn: async ({ retailProductId, isSubscription, subscriptionFrequency }: { 
      retailProductId: string; 
      isSubscription: boolean; 
      subscriptionFrequency?: string;
    }) => {
      await apiRequest("POST", "/api/retail-cart", {
        retailProductId,
        quantity: 1,
        isSubscription,
        subscriptionFrequency,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
      setAddedToCart(prev => new Set(prev).add(variables.retailProductId));
      setTimeout(() => {
        setAddedToCart(prev => {
          const next = new Set(prev);
          next.delete(variables.retailProductId);
          return next;
        });
      }, 2000);
      
      toast({
        title: "Added to cart",
        description: "Item successfully added to your cart",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add item to cart",
        variant: "destructive",
      });
    },
  });

  const groupedProducts = products?.reduce((acc, product) => {
    if (!acc[product.unitType]) {
      acc[product.unitType] = [];
    }
    acc[product.unitType].push(product);
    return acc;
  }, {} as Record<string, RetailProductWithFlavor[]>) || {};

  const oneTimePurchase = (retailProductId: string) => {
    addToCartMutation.mutate({
      retailProductId,
      isSubscription: false,
    });
  };

  const subscriptionPurchase = (retailProductId: string, frequency: string) => {
    addToCartMutation.mutate({
      retailProductId,
      isSubscription: true,
      subscriptionFrequency: frequency,
    });
  };

  if (isLoading) {
    return (
      <>
        <Navbar />
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground">Loading products...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="min-h-screen bg-background">
        <div 
          className="relative h-96 bg-cover bg-center flex items-center justify-center"
          style={{ backgroundImage: `linear-gradient(rgba(0, 0, 0, 0.5), rgba(0, 0, 0, 0.5)), url(${seattleHero})` }}
        >
          <div className="text-center text-white px-4">
            <img 
              src={logo} 
              alt="Puget Sound Kombucha Co." 
              className="h-48 mx-auto"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </div>
        </div>

        <div className="bg-muted/50 py-12">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <p className="text-lg md:text-xl mb-4">
              <span className="font-semibold">Retailers and Distributors:</span> Get in touch with us{" "}
              <a 
                href="/contact" 
                className="hover:underline font-semibold"
                style={{ color: '#F2C179' }}
                data-testid="link-wholesale-contact"
              >
                here
              </a>{" "}
              for wholesale pricing.
            </p>
          </div>
        </div>

        <div className="container mx-auto px-4 py-8">
          <div className="mb-8">
            <h2 className="text-3xl font-bold mb-2" data-testid="text-products-title">Shop Our Kombucha</h2>
            <p className="text-muted-foreground" data-testid="text-products-subtitle">Choose from cases, kegs, and more</p>
          </div>

          {Object.entries(groupedProducts).map(([unitType, unitProducts]) => (
            <div key={unitType} className="mb-12">
              <h3 className="text-2xl font-semibold mb-4 capitalize" data-testid={`text-unit-type-${unitType}`}>
                {unitType === 'case' ? 'Cases (12 Bottles)' : unitType.replace(/-/g, ' ')}
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {unitProducts
                  .filter(p => p.isActive && p.flavor.isActive)
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((product) => (
                    <Card key={product.id} data-testid={`card-product-${product.id}`} className="overflow-hidden">
                      <CardHeader className="p-0">
                        <div className="aspect-square bg-muted overflow-hidden">
                          {product.flavor.primaryImageUrl ? (
                            <img 
                              src={product.flavor.primaryImageUrl} 
                              alt={product.flavor.name}
                              className="w-full h-full object-cover"
                              data-testid={`image-${product.id}`}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <p className="text-muted-foreground">No image available</p>
                            </div>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="p-4">
                        <h3 className="text-xl font-semibold mb-2" data-testid={`text-flavor-${product.id}`}>
                          {product.flavor.name}
                        </h3>
                        <Badge variant="secondary" className="mb-2" data-testid={`badge-profile-${product.id}`}>
                          {product.flavor.flavorProfile}
                        </Badge>
                        <p className="text-sm text-muted-foreground mb-3" data-testid={`text-description-${product.id}`}>
                          {product.flavor.description}
                        </p>
                        <p className="text-sm text-muted-foreground mb-3" data-testid={`text-unit-${product.id}`}>
                          {product.unitDescription}
                        </p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-bold" data-testid={`text-price-${product.id}`}>
                            ${parseFloat(product.price).toFixed(2)}
                          </p>
                          {product.subscriptionDiscount != null && Number(product.subscriptionDiscount) > 0 && (
                            <Badge variant="default" className="text-xs" data-testid={`badge-discount-${product.id}`}>
                              Save {Number(product.subscriptionDiscount).toFixed(0)}%
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                      <CardFooter className="p-4 pt-0 flex-col gap-2">
                        <Tabs defaultValue="one-time" className="w-full">
                          <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="one-time" data-testid={`tab-one-time-${product.id}`}>
                              One-time
                            </TabsTrigger>
                            <TabsTrigger value="subscribe" data-testid={`tab-subscribe-${product.id}`}>
                              Subscribe
                            </TabsTrigger>
                          </TabsList>
                          <TabsContent value="one-time" className="mt-2">
                            <Button
                              onClick={() => oneTimePurchase(product.id)}
                              disabled={addToCartMutation.isPending || addedToCart.has(product.id)}
                              className="w-full"
                              data-testid={`button-add-one-time-${product.id}`}
                            >
                              {addedToCart.has(product.id) ? (
                                <>
                                  <Check className="w-4 h-4 mr-2" />
                                  Added
                                </>
                              ) : (
                                <>
                                  <ShoppingCart className="w-4 h-4 mr-2" />
                                  Add to Cart
                                </>
                              )}
                            </Button>
                          </TabsContent>
                          <TabsContent value="subscribe" className="mt-2 space-y-2">
                            {product.subscriptionDiscount != null && Number(product.subscriptionDiscount) > 0 && (
                              <div className="text-center py-2 px-3 bg-accent/10 rounded-md mb-2">
                                <p className="text-sm font-semibold text-accent">
                                  Subscribe & Save {Number(product.subscriptionDiscount).toFixed(0)}%
                                </p>
                                <p className="text-lg font-bold mt-1" data-testid={`text-subscription-price-${product.id}`}>
                                  ${(parseFloat(product.price) * (1 - Number(product.subscriptionDiscount) / 100)).toFixed(2)}
                                </p>
                                <p className="text-xs text-muted-foreground">per delivery</p>
                              </div>
                            )}
                            <Button
                              onClick={() => subscriptionPurchase(product.id, 'weekly')}
                              disabled={addToCartMutation.isPending}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-weekly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Weekly
                            </Button>
                            <Button
                              onClick={() => subscriptionPurchase(product.id, 'bi-weekly')}
                              disabled={addToCartMutation.isPending}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-biweekly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Every 2 Weeks
                            </Button>
                            <Button
                              onClick={() => subscriptionPurchase(product.id, 'every-4-weeks')}
                              disabled={addToCartMutation.isPending}
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-monthly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Monthly
                            </Button>
                          </TabsContent>
                        </Tabs>
                      </CardFooter>
                    </Card>
                  ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
