import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { RetailProduct, Flavor, RetailCartItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShoppingCart, Check, ChevronLeft, ChevronRight, Image as ImageIcon } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import seattleHero from "@assets/stock_images/seattle_skyline_with_db3ee238.jpg";
import logo from "@assets/text-stacked-black_1762299663824.png";
import { Footer } from "@/components/layout/footer";
import { SubscribeOptions } from "@/components/subscribe-options";
import { useAuth } from "@/hooks/use-auth";

type RetailCartItemWithProduct = RetailCartItem & {
  retailProduct: RetailProduct & { flavor: Flavor | null; flavors: Flavor[] };
};

function ProductImageCarousel({ 
  primaryImageUrl, 
  secondaryImageUrl, 
  productName,
  productId 
}: { 
  primaryImageUrl?: string | null; 
  secondaryImageUrl?: string | null; 
  productName: string;
  productId: string;
}) {
  const images = [primaryImageUrl, secondaryImageUrl].filter(Boolean) as string[];
  const [currentIndex, setCurrentIndex] = useState(0);
  
  if (images.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted">
        <ImageIcon className="w-16 h-16 text-muted-foreground" />
      </div>
    );
  }
  
  return (
    <div className="relative group w-full h-full">
      <img 
        src={images[currentIndex]} 
        alt={`${productName} - ${currentIndex === 0 ? 'Primary' : 'Secondary'}`}
        className="w-full h-full object-cover"
        data-testid={`image-${productId}`}
      />
      
      {images.length > 1 && (
        <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex((currentIndex - 1 + images.length) % images.length);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous image" data-testid={`button-prev-image-${productId}`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setCurrentIndex((currentIndex + 1) % images.length);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next image" data-testid={`button-next-image-${productId}`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
          
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {images.map((_, idx) => (
              <button
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  setCurrentIndex(idx);
                }}
                className={`w-2 h-2 rounded-full transition-all ${
                  idx === currentIndex 
                    ? 'bg-white w-6' 
                    : 'bg-white/50 hover:bg-white/75'
                }`}
                aria-label={`Go to image ${idx + 1}`} data-testid={`button-dot-${productId}-${idx}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

type RetailProductWithFlavors = RetailProduct & {
  flavor: Flavor | null;
  flavors: Flavor[];
};

export default function ShopV2() {
  // Drives the two audience lanes in the hero: a signed-in wholesale customer gets
  // reorder shortcuts, a signed-in retail customer gets their subscription, everyone
  // else gets the two front doors.
  const { user } = useAuth();
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const [selectedFlavors, setSelectedFlavors] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<RetailProductWithFlavors[]>({
    queryKey: ["/api/retail-products"],
  });

  const { data: cartItems = [] } = useQuery<RetailCartItemWithProduct[]>({
    queryKey: ["/api/retail-cart"],
  });

  const hasSubscriptionItems = cartItems.some(item => item.isSubscription);
  const hasOneTimeItems = cartItems.some(item => !item.isSubscription);

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
    if (hasSubscriptionItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your subscription order first, or remove subscription items from your cart.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({
      retailProductId,
      selectedFlavorId,
      isSubscription: false,
    });
  };

  const subscriptionPurchase = (retailProductId: string, frequency: string, selectedFlavorId?: string) => {
    if (hasOneTimeItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your one-time order first, or remove one-time items from your cart.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({
      retailProductId,
      selectedFlavorId,
      isSubscription: true,
      subscriptionFrequency: frequency,
    });
  };

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

      {/* Who are you, and what should you do here? Two lanes — trade and home — each with
          the one or two actions that matter, and each aware of whether you're already a
          customer. The old banner was a single line of text pointing retailers at a contact
          form; everyone else had to guess that the products below were pickup-only. */}
      <div className="bg-muted/50 py-10">
        <div className="container mx-auto px-4 grid gap-6 md:grid-cols-2 max-w-5xl">
          {/* Trade lane */}
          <div className="bg-background border rounded-md p-6 flex flex-col" data-testid="lane-wholesale">
            <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">For shops, cafés &amp; restaurants</p>
            {user?.role === "wholesale_customer" ? (
              <>
                <h2 className="text-2xl font-bold mt-2">Wholesale orders</h2>
                <p className="text-muted-foreground mt-1 flex-1">Reorder your usual in a couple of taps, or build a new order.</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-reorder">
                    <Link href="/wholesale-customer/orders">Reorder from a past order</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-new-order">
                    <Link href="/wholesale-customer/place-order">Place a new order</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mt-2">Wholesale ordering</h2>
                <p className="text-muted-foreground mt-1 flex-1">
                  Cases and kegs, delivered or picked up. Order with just your email &mdash; no password.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-wholesale-login">
                    <Link href="/wholesale/login">Order online</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-wholesale-apply">
                    <Link href="/wholesale/apply">Apply for a wholesale account</Link>
                  </Button>
                </div>
              </>
            )}
          </div>

          {/* Home lane */}
          <div className="bg-background border rounded-md p-6 flex flex-col" data-testid="lane-retail">
            <p className="text-xs font-semibold tracking-wider uppercase text-muted-foreground">For your fridge</p>
            {user && user.role !== "wholesale_customer" ? (
              <>
                <h2 className="text-2xl font-bold mt-2">Retail orders</h2>
                <p className="text-muted-foreground mt-1 flex-1">Shop below, or manage your Subscribe &amp; Save deliveries.</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-shop">
                    <a href="#shop">Shop kombucha</a>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-account">
                    <Link href="/my-account">My subscription</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mt-2">Shop 12-packs &amp; kegs</h2>
                <p className="text-muted-foreground mt-1 flex-1">
                  Pick up at the brewery in Ballard, Mon&ndash;Thu. Subscribe &amp; Save 10% on a standing order you can skip or pause any time.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-shop">
                    <a href="#shop">Shop kombucha</a>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-subscribe">
                    <a href="#shop">Subscribe &amp; Save</a>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div id="shop" className="container mx-auto px-4 py-8 scroll-mt-4">
        <div className="mb-8">
          <h2 className="text-3xl font-bold mb-2" data-testid="text-products-title">Shop Our Kombucha</h2>
          
          {/* Pickup Location Notice */}
          <div className="bg-primary text-primary-foreground py-3 px-4 rounded-md mt-4 inline-flex items-center gap-3">
            <div>
              <span className="font-semibold">Pickup Only at Our Ballard Location:</span>{" "}
              <span className="opacity-90">4501 Shilshole Ave NW, Seattle, WA 98107</span>
            </div>
          </div>
        </div>

        {/* Products load after the hero and lanes are already on screen — the page
            never blanks while the catalogue query is in flight. */}
        {isLoading && (
          <p className="text-muted-foreground py-12" data-testid="text-products-loading">Loading products...</p>
        )}

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
                    // For multi-flavor products, check if all flavors are active.
                    // `every` is true for an empty array, which would render an
                    // un-orderable card, so require at least one flavor.
                    if (p.productType === 'multi-flavor') {
                      return p.flavors.length > 0 && p.flavors.every(f => f.isActive);
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
                        <Link href={`/products/${product.id}`} data-testid={`link-product-${product.id}`}>
                          <div className="aspect-square bg-muted overflow-hidden cursor-pointer hover:opacity-90 transition-opacity">
                            {isMultiFlavor ? (
                              imageUrl ? (
                                <img 
                                  src={imageUrl} 
                                  alt={displayName || 'Product'}
                                  className="w-full h-full object-cover"
                                  data-testid={`image-${product.id}`}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <ImageIcon className="w-16 h-16 text-muted-foreground" />
                                </div>
                              )
                            ) : (
                              <ProductImageCarousel
                                primaryImageUrl={product.flavor?.primaryImageUrl}
                                secondaryImageUrl={product.flavor?.secondaryImageUrl}
                                productName={displayName || 'Product'}
                                productId={product.id}
                              />
                            )}
                          </div>
                        </Link>
                      </CardHeader>
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <Link href={`/products/${product.id}`}>
                            <h3 className="text-xl font-semibold hover:text-primary transition-colors cursor-pointer" data-testid={`text-flavor-${product.id}`}>
                              {displayName}
                            </h3>
                          </Link>
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
                        
                        {/* Show tabs only if subscription discount > 0.
                            Tabs default to whichever mode the cart is already in, and the
                            other is disabled — the blocked option used to stay fully
                            enabled and only fail with a destructive toast on click. */}
                        {product.subscriptionDiscount != null && Number(product.subscriptionDiscount) > 0 ? (
                          <Tabs defaultValue={hasSubscriptionItems ? "subscribe" : "one-time"} className="w-full">
                            <TabsList className="grid w-full grid-cols-2">
                              <TabsTrigger
                                value="one-time"
                                disabled={hasSubscriptionItems}
                                data-testid={`tab-one-time-${product.id}`}
                              >
                                One-time
                              </TabsTrigger>
                              <TabsTrigger
                                value="subscribe"
                                disabled={hasOneTimeItems}
                                data-testid={`tab-subscribe-${product.id}`}
                              >
                                Subscribe
                              </TabsTrigger>
                            </TabsList>
                            <TabsContent value="one-time" className="mt-2">
                            {hasSubscriptionItems ? (
                              <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                                Your cart has a subscription. Check out first, then one-time
                                items can go in your next order.
                              </div>
                            ) : (
                            <Button
                              onClick={() => {
                                const flavorId = isMultiFlavor ? selectedFlavors[product.id] : product.flavor?.id;
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
                          </TabsContent>
                          <TabsContent value="subscribe" className="mt-2 space-y-2">
                            {hasOneTimeItems ? (
                              <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                                Your cart has one-time items. Check those out first, then start a
                                subscription — the two are ordered separately.
                              </div>
                            ) : (
                              <SubscribeOptions
                                price={product.price}
                                subscriptionDiscount={product.subscriptionDiscount}
                                disabled={
                                  addToCartMutation.isPending ||
                                  (isMultiFlavor && !selectedFlavors[product.id])
                                }
                                testIdPrefix={product.id}
                                onSelect={(frequency) => {
                                  const flavorId = isMultiFlavor ? selectedFlavors[product.id] : product.flavor?.id;
                                  if (isMultiFlavor && !flavorId) {
                                    toast({
                                      title: "Please select a flavor",
                                      description: "Choose which flavor you'd like from the dropdown above",
                                      variant: "destructive",
                                    });
                                    return;
                                  }
                                  subscriptionPurchase(product.id, frequency, flavorId);
                                }}
                              />
                            )}
                          </TabsContent>
                        </Tabs>
                        ) : (
                          /* No subscription option - show only one-time purchase button */
                          <Button
                            onClick={() => {
                              const flavorId = isMultiFlavor ? selectedFlavors[product.id] : product.flavor?.id;
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
      
      <Footer />
    </div>
  );
}
