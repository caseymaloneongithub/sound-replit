import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Product } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/navbar";
import { ShoppingCart, Plus, Check } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import seattleHero from "@assets/stock_images/seattle_skyline_with_db3ee238.jpg";

export default function Shop() {
  const [selectedFlavor, setSelectedFlavor] = useState<string>("all");
  const [addedToCart, setAddedToCart] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const addToCartMutation = useMutation({
    mutationFn: async (productId: string) => {
      await apiRequest("POST", "/api/cart", {
        productId,
        quantity: 1,
      });
    },
    onSuccess: (_, productId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cart"] });
      setAddedToCart(prev => new Set(prev).add(productId));
      setTimeout(() => {
        setAddedToCart(prev => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      }, 2000);
      toast({
        title: "Added to cart",
        description: "Item added successfully",
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

  const filteredProducts = products?.filter(
    (p) => selectedFlavor === "all" || p.flavor.toLowerCase().includes(selectedFlavor.toLowerCase())
  ) || [];

  const flavors = ["all", "citrus", "berry", "green tea", "ginger"];

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
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
          <h1 className="text-5xl md:text-7xl font-bold text-white mb-6" style={{ fontFamily: 'var(--font-heading)' }}>
            Puget Sound Kombucha Co.
          </h1>
          <p className="text-xl md:text-2xl text-white/90 mb-8 max-w-2xl mx-auto">
            Craft kombucha from the Pacific Northwest. Handcrafted with organic ingredients.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Button 
              size="lg" 
              className="text-lg px-8 rounded-full"
              data-testid="button-shop-now"
              onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Shop Now
            </Button>
            <Button 
              size="lg" 
              variant="outline" 
              className="text-lg px-8 rounded-full backdrop-blur-md bg-white/10 border-white/30 text-white hover:bg-white/20"
              data-testid="button-view-subscriptions"
              onClick={() => window.location.href = '/subscriptions'}
            >
              View Subscriptions
            </Button>
          </div>
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

        <div className="flex gap-3 justify-center mb-12 flex-wrap">
          {flavors.map((flavor) => (
            <Button
              key={flavor}
              variant={selectedFlavor === flavor ? "default" : "outline"}
              onClick={() => setSelectedFlavor(flavor)}
              className="rounded-full capitalize"
              data-testid={`button-filter-${flavor}`}
            >
              {flavor}
            </Button>
          ))}
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
            {filteredProducts.map((product) => (
              <Card key={product.id} className="overflow-hidden hover-elevate" data-testid={`card-product-${product.id}`}>
                <CardHeader className="p-0">
                  <div className="aspect-square bg-card overflow-hidden">
                    <img 
                      src={product.imageUrl} 
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <h3 className="text-xl font-semibold mb-3" style={{ fontFamily: 'var(--font-heading)' }}>
                    {product.name}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {product.description}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">${product.retailPrice}</span>
                    <span className="text-sm text-muted-foreground">per bottle</span>
                  </div>
                </CardContent>
                <CardFooter className="p-6 pt-0">
                  <Button 
                    className="w-full rounded-full gap-2" 
                    disabled={!product.inStock || addToCartMutation.isPending}
                    onClick={() => addToCartMutation.mutate(product.id)}
                    data-testid={`button-add-to-cart-${product.id}`}
                  >
                    {addedToCart.has(product.id) ? (
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
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        {!isLoading && filteredProducts.length === 0 && (
          <div className="text-center py-20">
            <ShoppingCart className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-2xl font-semibold mb-2">No products found</h3>
            <p className="text-muted-foreground">Try selecting a different flavor filter</p>
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
                Get weekly or monthly deliveries at discounted rates
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
