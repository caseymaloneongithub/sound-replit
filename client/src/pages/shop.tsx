import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, Plus, Check, Repeat, ChevronLeft, ChevronRight } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import seattleHero from "@assets/stock_images/seattle_skyline_with_db3ee238.jpg";
import logo from "@assets/text-stacked-black_1762299663824.png";
import { getCasePrice } from "@shared/pricing";

function ProductImageCarousel({ product }: { product: Product }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const images = product.imageUrls && product.imageUrls.length > 0 
    ? product.imageUrls 
    : (product.imageUrl ? [product.imageUrl] : []);

  // Clamp currentIndex when image count changes
  useEffect(() => {
    if (currentIndex >= images.length && images.length > 0) {
      setCurrentIndex(images.length - 1);
    }
  }, [images.length, currentIndex]);

  const nextImage = () => {
    if (images.length > 0) {
      setCurrentIndex((prev) => (prev + 1) % images.length);
    }
  };

  const prevImage = () => {
    if (images.length > 0) {
      setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
    }
  };

  if (images.length === 0) {
    return (
      <div className="aspect-square bg-muted flex items-center justify-center rounded-md">
        <p className="text-muted-foreground">No image available</p>
      </div>
    );
  }

  return (
    <div className="relative aspect-square bg-card overflow-hidden rounded-md group">
      <img 
        src={images[currentIndex]} 
        alt={`${product.name} - Image ${currentIndex + 1}`}
        className="w-full h-full object-cover"
        data-testid={`image-${product.id}-${currentIndex}`}
      />
      
      {images.length > 1 && (
        <>
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              prevImage();
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity rounded-full"
            data-testid={`button-prev-${product.id}`}
            type="button"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={(e) => {
              e.preventDefault();
              nextImage();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity rounded-full"
            data-testid={`button-next-${product.id}`}
            type="button"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {images.map((_, index) => (
              <button
                key={index}
                onClick={(e) => {
                  e.preventDefault();
                  setCurrentIndex(index);
                }}
                className={`h-2 rounded-full transition-all ${
                  index === currentIndex 
                    ? 'bg-primary w-4' 
                    : 'bg-background/60 w-2'
                }`}
                data-testid={`button-dot-${product.id}-${index}`}
                type="button"
                aria-label={`Go to image ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Shop() {
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const addToCartMutation = useMutation({
    mutationFn: async ({ productId, isSubscription, subscriptionFrequency }: { 
      productId: string; 
      isSubscription: boolean; 
      subscriptionFrequency?: string;
    }) => {
      await apiRequest("POST", "/api/cart", {
        productId,
        quantity: 1,
        isSubscription,
        subscriptionFrequency,
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      const key = `${variables.productId}-${variables.isSubscription}-${variables.subscriptionFrequency || 'onetime'}`;
      setAddedToCart(prev => new Set(prev).add(key));
      setTimeout(() => {
        setAddedToCart(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 2000);
      toast({
        title: "Added to cart",
        description: variables.isSubscription ? "Subscription added successfully" : "Item added successfully",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add item to cart",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <div className="relative h-[70vh] md:h-[70vh] flex items-center justify-center overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img 
            src={seattleHero} 
            alt="Seattle skyline and Puget Sound" 
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/50 to-black/70" />
        </div>
        
        <div className="relative z-10 text-center px-6 max-w-4xl">
          <img 
            src={logo} 
            alt="Puget Sound Kombucha Company" 
            className="mx-auto mb-8"
            style={{ filter: 'brightness(0) invert(1)', height: '336px' }}
            data-testid="logo-hero"
          />
          <div className="flex gap-4 justify-center flex-wrap">
            <Button 
              size="lg" 
              className="text-lg px-8 rounded-full"
              data-testid="button-shop-now"
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Shop Now
            </Button>
          </div>
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

      <div id="products" className="max-w-7xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-4xl md:text-5xl font-bold mb-4" style={{ fontFamily: 'var(--font-heading)' }}>
            Featured Flavors
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Discover our handcrafted kombucha, brewed with care using organic ingredients
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="overflow-hidden">
                <CardHeader className="p-0">
                  <div className="aspect-square bg-muted animate-pulse" />
                </CardHeader>
                <CardContent className="p-6">
                  <div className="h-6 bg-muted rounded mb-3 animate-pulse" />
                  <div className="h-4 bg-muted rounded w-3/4 animate-pulse" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {products?.map((product) => {
              const casePrice = getCasePrice(false);
              const subscriptionPrice = getCasePrice(true);
              const oneTimeKey = `${product.id}-false-onetime`;
              const weeklyKey = `${product.id}-true-weekly`;
              const biweeklyKey = `${product.id}-true-bi-weekly`;
              const every4weeksKey = `${product.id}-true-every-4-weeks`;
              
              return (
                <Card key={product.id} className="overflow-hidden hover-elevate" data-testid={`card-product-${product.id}`}>
                  <CardHeader className="p-0">
                    <ProductImageCarousel product={product} />
                  </CardHeader>
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: 'var(--font-heading)' }}>
                      {product.name}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {product.description}
                    </p>
                    
                    <Tabs defaultValue="onetime" className="w-full">
                      <TabsList className="grid w-full grid-cols-2 mb-4">
                        <TabsTrigger value="onetime" data-testid={`tab-onetime-${product.id}`}>One-Time</TabsTrigger>
                        <TabsTrigger value="subscribe" data-testid={`tab-subscribe-${product.id}`}>Subscribe & Save</TabsTrigger>
                      </TabsList>
                      
                      <TabsContent value="onetime" className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold">${casePrice}</span>
                            <span className="text-sm text-muted-foreground">per case of 12</span>
                          </div>
                        </div>
                        <Button 
                          className="w-full rounded-full gap-2" 
                          disabled={!product.inStock || addToCartMutation.isPending}
                          onClick={() => addToCartMutation.mutate({ 
                            productId: product.id, 
                            isSubscription: false 
                          })}
                          data-testid={`button-add-onetime-${product.id}`}
                        >
                          {addedToCart.has(oneTimeKey) ? (
                            <>
                              <Check className="w-4 h-4" />
                              Added!
                            </>
                          ) : (
                            <>
                              <Plus className="w-4 h-4" />
                              {product.inStock ? 'Add to Cart' : 'Out of Stock'}
                            </>
                          )}
                        </Button>
                      </TabsContent>
                      
                      <TabsContent value="subscribe" className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-bold">${subscriptionPrice}</span>
                            <span className="text-sm text-muted-foreground">per case of 12</span>
                          </div>
                          <Badge variant="secondary" className="w-fit">
                            10% off with subscription
                          </Badge>
                          <p className="text-sm text-muted-foreground">
                            Choose your delivery frequency and manage your subscription anytime
                          </p>
                        </div>
                        
                        <Button 
                          className="w-full rounded-full gap-2" 
                          disabled={!product.inStock}
                          onClick={() => window.location.href = `/product-subscribe/${product.id}`}
                          data-testid={`button-subscribe-${product.id}`}
                        >
                          <Repeat className="w-4 h-4" />
                          {product.inStock ? 'Subscribe Now' : 'Out of Stock'}
                        </Button>
                      </TabsContent>
                    </Tabs>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {!isLoading && products?.length === 0 && (
          <div className="text-center py-20">
            <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-2xl font-semibold mb-2">No products available</h3>
            <p className="text-muted-foreground">Check back soon for new flavors</p>
          </div>
        )}
      </div>

      <div className="bg-muted py-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-3 gap-8 text-center">
            <div>
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary-foreground">1</span>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                Choose Your Favorites
              </h3>
              <p className="text-muted-foreground">
                Select from our rotating selection of seasonal flavors
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary-foreground">2</span>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                Subscribe & Save
              </h3>
              <p className="text-muted-foreground">
                Get weekly, bi-weekly, or every 4 weeks deliveries at 10% off
              </p>
            </div>
            <div>
              <div className="w-16 h-16 bg-primary rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl font-bold text-primary-foreground">3</span>
              </div>
              <h3 className="text-xl font-semibold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                Pick Up Locally
              </h3>
              <p className="text-muted-foreground">
                Convenient pickup at our brewery location
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
