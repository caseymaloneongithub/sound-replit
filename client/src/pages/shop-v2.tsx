import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { RetailProduct, Flavor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Plus, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import seattleHero from "@assets/stock_images/seattle_skyline_with_db3ee238.jpg";
import logo from "@assets/text-stacked-black_1762299663824.png";

type RetailProductWithFlavors = RetailProduct & {
  flavor: Flavor | null;
  flavors: Flavor[];
};

export default function ShopV2() {
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const [selectedFlavors, setSelectedFlavors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<RetailProductWithFlavors[]>({
    queryKey: ["/api/retail-products"],
  });

  const addToCartMutation = useMutation({
    mutationFn: async ({ retailProductId, selectedFlavorId, isSubscription, subscriptionFrequency }: { 
      retailProductId: string;
      selectedFlavorId?: string;
      isSubscription: boolean; 
      subscriptionFrequency?: string;
    }) => {
      await apiRequest("POST", "/api/retail-cart", {
        retailProductId,
        selectedFlavorId,
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
  }, {} as Record<string, RetailProductWithFlavors[]>) || {};

  const oneTimePurchase = (retailProductId: string, selectedFlavorId?: string) => {
    addToCartMutation.mutate({
      retailProductId,
      selectedFlavorId,
      isSubscription: false,
    });
  };

  const subscriptionPurchase = (retailProductId: string, frequency: string, selectedFlavorId?: string) => {
    addToCartMutation.mutate({
      retailProductId,
      selectedFlavorId,
      isSubscription: true,
      subscriptionFrequency: frequency,
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading products...</p>
      </div>
    );
  }

  return (
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
                  .filter(p => {
                    if (!p.isActive) return false;
                    // For single-flavor products, check if the flavor is active
                    if (p.productType === 'single-flavor' && p.flavor) {
                      return p.flavor.isActive;
                    }
                    // For multi-flavor products, check if all flavors are active
                    if (p.productType === 'multi-flavor') {
                      return p.flavors.every(f => f.isActive);
                    }
                    return true;
                  })
                  .sort((a, b) => a.displayOrder - b.displayOrder)
                  .map((product) => {
                    const isMultiFlavor = product.productType === 'multi-flavor';
                    const imageUrl = isMultiFlavor ? product.productImageUrl : product.flavor?.primaryImageUrl;
                    const displayName = isMultiFlavor ? product.productName : product.flavor?.name;
                    
                    return (
                    <Card key={product.id} data-testid={`card-product-${product.id}`} className="overflow-hidden">
                      <CardHeader className="p-0">
                        <div className="aspect-square bg-muted overflow-hidden">
                          {imageUrl ? (
                            <img 
                              src={imageUrl} 
                              alt={displayName || 'Product'}
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
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <h3 className="text-xl font-semibold" data-testid={`text-flavor-${product.id}`}>
                            {displayName}
                          </h3>
                        </div>
                        {!isMultiFlavor && product.flavor && (
                          <Badge variant="secondary" className="mb-2" data-testid={`badge-profile-${product.id}`}>
                            {product.flavor.flavorProfile}
                          </Badge>
                        )}
                        {!isMultiFlavor && product.flavor && (
                          <p className="text-sm text-muted-foreground mb-3" data-testid={`text-description-${product.id}`}>
                            {product.flavor.description}
                          </p>
                        )}
                        {isMultiFlavor && product.flavors.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-muted-foreground mb-1">Flavor Options:</p>
                            <div className="flex flex-wrap gap-1">
                              {product.flavors.map((flavor) => (
                                <Badge key={flavor.id} variant="secondary" className="text-xs">
                                  {flavor.name}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        <p className="text-sm text-muted-foreground mb-3" data-testid={`text-unit-${product.id}`}>
                          {product.unitDescription}
                        </p>
                        <div className="flex items-baseline gap-2">
                          <p className="text-2xl font-bold" data-testid={`text-price-${product.id}`}>
                            ${parseFloat(product.price).toFixed(2)}
                          </p>
                          {product.subscriptionDiscount != null && Number(product.subscriptionDiscount) > 0 && (
                            <Badge variant="default" className="text-xs" data-testid={`badge-discount-${product.id}`}>
                              Subscribe & Save {Number(product.subscriptionDiscount).toFixed(0)}%
                            </Badge>
                          )}
                        </div>
                        {product.deposit && Number(product.deposit) > 0 && (
                          <p className="text-sm text-muted-foreground mt-1" data-testid={`text-deposit-${product.id}`}>
                            + ${parseFloat(product.deposit).toFixed(2)} refundable deposit
                          </p>
                        )}
                      </CardContent>
                      <CardFooter className="p-4 pt-0 flex-col gap-2">
                        {/* Flavor selector for multi-flavor products */}
                        {isMultiFlavor && product.flavors.length > 0 && (
                          <div className="w-full mb-2">
                            <Label className="text-xs text-muted-foreground mb-1">Select Flavor</Label>
                            <Select
                              value={selectedFlavors[product.id] || ''}
                              onValueChange={(value) => setSelectedFlavors(prev => ({ ...prev, [product.id]: value }))}
                            >
                              <SelectTrigger data-testid={`select-flavor-${product.id}`} className="w-full">
                                <SelectValue placeholder="Choose a flavor" />
                              </SelectTrigger>
                              <SelectContent>
                                {product.flavors.filter(f => f.isActive).map((flavor) => (
                                  <SelectItem key={flavor.id} value={flavor.id}>
                                    {flavor.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        
                        {/* Show tabs only if subscription discount > 0 */}
                        {product.subscriptionDiscount != null && Number(product.subscriptionDiscount) > 0 ? (
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
                              onClick={() => {
                                const flavorId = isMultiFlavor ? selectedFlavors[product.id] : undefined;
                                if (isMultiFlavor && !flavorId) {
                                  toast({ 
                                    title: "Please select a flavor", 
                                    description: "Choose which flavor you'd like from the dropdown above",
                                    variant: "destructive" 
                                  });
                                  return;
                                }
                                oneTimePurchase(product.id, flavorId);
                              }}
                              disabled={
                                addToCartMutation.isPending || 
                                addedToCart.has(product.id) ||
                                (isMultiFlavor && !selectedFlavors[product.id])
                              }
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
                              onClick={() => {
                                const flavorId = isMultiFlavor ? selectedFlavors[product.id] : undefined;
                                if (isMultiFlavor && !flavorId) {
                                  toast({ 
                                    title: "Please select a flavor", 
                                    description: "Choose which flavor you'd like from the dropdown above",
                                    variant: "destructive" 
                                  });
                                  return;
                                }
                                subscriptionPurchase(product.id, 'weekly', flavorId);
                              }}
                              disabled={
                                addToCartMutation.isPending ||
                                (isMultiFlavor && !selectedFlavors[product.id])
                              }
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-weekly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Weekly
                            </Button>
                            <Button
                              onClick={() => {
                                const flavorId = isMultiFlavor ? selectedFlavors[product.id] : undefined;
                                if (isMultiFlavor && !flavorId) {
                                  toast({ 
                                    title: "Please select a flavor", 
                                    description: "Choose which flavor you'd like from the dropdown above",
                                    variant: "destructive" 
                                  });
                                  return;
                                }
                                subscriptionPurchase(product.id, 'bi-weekly', flavorId);
                              }}
                              disabled={
                                addToCartMutation.isPending ||
                                (isMultiFlavor && !selectedFlavors[product.id])
                              }
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-biweekly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Every 2 Weeks
                            </Button>
                            <Button
                              onClick={() => {
                                const flavorId = isMultiFlavor ? selectedFlavors[product.id] : undefined;
                                if (isMultiFlavor && !flavorId) {
                                  toast({ 
                                    title: "Please select a flavor", 
                                    description: "Choose which flavor you'd like from the dropdown above",
                                    variant: "destructive" 
                                  });
                                  return;
                                }
                                subscriptionPurchase(product.id, 'every-4-weeks', flavorId);
                              }}
                              disabled={
                                addToCartMutation.isPending ||
                                (isMultiFlavor && !selectedFlavors[product.id])
                              }
                              variant="outline"
                              className="w-full"
                              data-testid={`button-subscribe-monthly-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-2" />
                              Monthly
                            </Button>
                          </TabsContent>
                        </Tabs>
                        ) : (
                          /* No subscription option - show only one-time purchase button */
                          <Button
                            onClick={() => {
                              const flavorId = isMultiFlavor ? selectedFlavors[product.id] : undefined;
                              if (isMultiFlavor && !flavorId) {
                                toast({ 
                                  title: "Please select a flavor", 
                                  description: "Choose which flavor you'd like from the dropdown above",
                                  variant: "destructive" 
                                });
                                return;
                              }
                              oneTimePurchase(product.id, flavorId);
                            }}
                            disabled={
                              addToCartMutation.isPending || 
                              addedToCart.has(product.id) ||
                              (isMultiFlavor && !selectedFlavors[product.id])
                            }
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
                        )}
                      </CardFooter>
                    </Card>
                    );
                  })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
