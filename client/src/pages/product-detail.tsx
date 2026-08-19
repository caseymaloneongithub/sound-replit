import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { RetailProduct, Flavor, RetailCartItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, ShoppingCart, Check, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Footer } from "@/components/layout/footer";
import { SubscribeOptions } from "@/components/subscribe-options";

type RetailProductWithFlavors = RetailProduct & {
  flavor: Flavor | null;
  flavors: Flavor[];
};

type RetailCartItemWithProduct = RetailCartItem & {
  retailProduct: RetailProduct & { flavor: Flavor | null; flavors: Flavor[] };
};

function ProductImageCarousel({ 
  primaryImageUrl, 
  secondaryImageUrl, 
  productName 
}: { 
  primaryImageUrl?: string | null; 
  secondaryImageUrl?: string | null; 
  productName: string;
}) {
  const images = [primaryImageUrl, secondaryImageUrl].filter(Boolean) as string[];
  const [currentIndex, setCurrentIndex] = useState(0);
  
  if (images.length === 0) {
    return (
      <div className="w-full aspect-square md:aspect-[4/3] flex items-center justify-center bg-muted rounded-lg">
      </div>
    );
  }
  
  return (
    <div className="relative group w-full aspect-square md:aspect-[4/3] rounded-lg overflow-hidden">
      <img 
        src={images[currentIndex]} 
        alt={`${productName} - ${currentIndex === 0 ? 'Primary' : 'Secondary'}`}
        className="w-full h-full object-cover"
        data-testid="image-product-detail"
      />
      
      {images.length > 1 && (
        <>
          <button
            onClick={() => setCurrentIndex((currentIndex - 1 + images.length) % images.length)}
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Previous image" data-testid="button-prev-image"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            onClick={() => setCurrentIndex((currentIndex + 1) % images.length)}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-3 opacity-0 group-hover:opacity-100 transition-opacity"
            aria-label="Next image" data-testid="button-next-image"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
          
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
            {images.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentIndex(idx)}
                className={`w-3 h-3 rounded-full transition-all ${
                  idx === currentIndex 
                    ? 'bg-white w-8' 
                    : 'bg-white/50 hover:bg-white/75'
                }`}
                aria-label={`Go to image ${idx + 1}`} data-testid={`button-dot-${idx}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const [selectedFlavor, setSelectedFlavor] = useState<string>("");
  const [addedToCart, setAddedToCart] = useState(false);
  const { toast } = useToast();

  const { data: products, isLoading: productsLoading } = useQuery<RetailProductWithFlavors[]>({
    queryKey: ["/api/retail-products"],
  });

  const { data: cartItems = [] } = useQuery<RetailCartItemWithProduct[]>({
    queryKey: ["/api/retail-cart"],
  });

  const hasSubscriptionItems = cartItems.some(item => item.isSubscription);
  const hasOneTimeItems = cartItems.some(item => !item.isSubscription);

  const product = products?.find(p => p.id === id);

  const addToCartMutation = useMutation({
    mutationFn: async ({ retailProductId, selectedFlavorId, isSubscription, subscriptionFrequency }: { 
      retailProductId: string;
      selectedFlavorId?: string;
      isSubscription: boolean; 
      subscriptionFrequency?: string;
    }) => {
      return await apiRequest("POST", "/api/retail-cart", {
        retailProductId,
        selectedFlavorId,
        quantity: 1,
        isSubscription,
        subscriptionFrequency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
      setAddedToCart(true);
      setTimeout(() => setAddedToCart(false), 2000);
      toast({
        title: "Added to cart",
        description: "Product has been added to your cart",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add to cart",
        variant: "destructive",
      });
    },
  });

  const oneTimePurchase = (selectedFlavorId?: string) => {
    if (!product) return;
    if (hasSubscriptionItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your subscription order first.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({
      retailProductId: product.id,
      selectedFlavorId,
      isSubscription: false,
    });
  };

  const subscriptionPurchase = (frequency: string, selectedFlavorId?: string) => {
    if (!product) return;
    if (hasOneTimeItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your one-time order first.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({
      retailProductId: product.id,
      selectedFlavorId,
      isSubscription: true,
      subscriptionFrequency: frequency,
    });
  };

  if (productsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Product not found</p>
        <Link href="/shop">
          <Button variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Shop
          </Button>
        </Link>
      </div>
    );
  }

  const isMultiFlavor = product.productType === 'multi-flavor';
  const displayName = isMultiFlavor ? product.productName : product.flavor?.name;
  const displayDescription = isMultiFlavor ? null : product.flavor?.description;
  const displayFlavorProfile = isMultiFlavor ? null : product.flavor?.flavorProfile;
  const displayIngredients = isMultiFlavor ? null : product.flavor?.ingredients;
  const imageUrl = isMultiFlavor ? product.productImageUrl : null;
  const primaryImageUrl = isMultiFlavor ? product.productImageUrl : product.flavor?.primaryImageUrl;
  const secondaryImageUrl = isMultiFlavor ? null : product.flavor?.secondaryImageUrl;
  
  const subscriptionPrice = product.subscriptionDiscount 
    ? parseFloat(product.price) * (1 - Number(product.subscriptionDiscount) / 100)
    : null;

  // The selector only lists active flavors, so gate on those — otherwise a product
  // whose flavors are all inactive shows an empty dropdown and a permanently
  // disabled button with no explanation.
  const activeFlavors = product.flavors?.filter((f) => f.isActive) ?? [];
  const needsFlavorSelection = isMultiFlavor && activeFlavors.length > 0;
  const canAddToCart = isMultiFlavor
    ? activeFlavors.length > 0 && !!selectedFlavor
    : true;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="container mx-auto px-4 py-8 flex-1">
        <Link href="/shop">
          <Button variant="ghost" className="mb-6" data-testid="button-back-to-shop">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Shop
          </Button>
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <ProductImageCarousel
              primaryImageUrl={primaryImageUrl}
              secondaryImageUrl={secondaryImageUrl}
              productName={displayName || 'Product'}
            />
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-3xl md:text-4xl font-bold mb-2" data-testid="text-product-name">
                {displayName}
              </h1>
              {displayFlavorProfile && (
                <Badge variant="secondary" className="mb-4" data-testid="badge-flavor-profile">
                  {displayFlavorProfile}
                </Badge>
              )}
              <p className="text-muted-foreground" data-testid="text-unit-description">
                {product.unitDescription}
              </p>
            </div>

            {displayDescription && (
              <div>
                <h2 className="font-semibold mb-2">About This Flavor</h2>
                <p className="text-muted-foreground" data-testid="text-description">
                  {displayDescription}
                </p>
              </div>
            )}

            {displayIngredients && displayIngredients.length > 0 && (
              <div>
                <h2 className="font-semibold mb-2">Ingredients</h2>
                <p className="text-muted-foreground" data-testid="text-ingredients">
                  {displayIngredients.join(", ")}
                </p>
              </div>
            )}

            {isMultiFlavor && product.flavors.length > 0 && (
              <div>
                <h2 className="font-semibold mb-2">Available Flavors</h2>
                <div className="flex flex-wrap gap-2 mb-4">
                  {product.flavors.filter(f => f.isActive).map((flavor) => (
                    <Badge key={flavor.id} variant="secondary">
                      {flavor.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <Card>
              <CardContent className="p-6">
                <div className="flex items-baseline gap-3 mb-4">
                  <span className="text-3xl font-bold" data-testid="text-price">
                    ${parseFloat(product.price).toFixed(2)}
                  </span>
                  {subscriptionPrice && (
                    <span className="text-lg text-muted-foreground">
                      or <span className="text-primary font-semibold">${subscriptionPrice.toFixed(2)}</span> with subscription
                    </span>
                  )}
                </div>
                {product.deposit && Number(product.deposit) > 0 && (
                  <p className="text-sm text-muted-foreground mb-4" data-testid="text-deposit">
                    + ${parseFloat(product.deposit).toFixed(2)} refundable deposit (one-time only)
                  </p>
                )}

                {needsFlavorSelection && (
                  <div className="mb-4">
                    <Label className="mb-2 block">Select Flavor</Label>
                    <Select
                      value={selectedFlavor}
                      onValueChange={setSelectedFlavor}
                    >
                      <SelectTrigger data-testid="select-flavor" className="w-full">
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

                <Tabs defaultValue="one-time" className="w-full">
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="one-time" data-testid="tab-one-time">One-Time Purchase</TabsTrigger>
                    <TabsTrigger value="subscribe" data-testid="tab-subscribe">Subscribe & Save</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="one-time">
                    <Button 
                      className="w-full" 
                      size="lg"
                      onClick={() => oneTimePurchase(selectedFlavor || undefined)}
                      disabled={!canAddToCart || addToCartMutation.isPending}
                      data-testid="button-add-to-cart"
                    >
                      {addToCartMutation.isPending ? (
                        <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                      ) : addedToCart ? (
                        <Check className="w-5 h-5 mr-2" />
                      ) : (
                        <ShoppingCart className="w-5 h-5 mr-2" />
                      )}
                      {addedToCart ? "Added to Cart" : "Add to Cart"}
                    </Button>
                  </TabsContent>
                  
                  <TabsContent value="subscribe" className="space-y-3">
                    {/* Same component the shop grid uses, so the offer, the discounted
                        price and the cadences are identical on both surfaces. */}
                    {hasOneTimeItems ? (
                      <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                        Your cart has one-time items. Check those out first, then start a
                        subscription — the two are ordered separately.
                      </div>
                    ) : (
                      <SubscribeOptions
                        price={product.price}
                        subscriptionDiscount={product.subscriptionDiscount}
                        disabled={!canAddToCart || addToCartMutation.isPending}
                        testIdPrefix="detail"
                        onSelect={(frequency) => subscriptionPurchase(frequency, selectedFlavor || undefined)}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <div className="text-center text-sm text-muted-foreground">
              <p>Pickup only at our Ballard location:</p>
              <p>4501 Shilshole Ave NW, Seattle, WA 98107</p>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
