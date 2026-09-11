import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Flavor, RetailCartItem } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShoppingCart, Check, ArrowLeft } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { flavorOptionLabel, FLAVOR_ACCENTS } from "@/lib/flavor-display";
import { packagesForFlavor, type ShopProduct, type FlavorPackage } from "@/lib/flavor-shop";
import { SubscribeOptions } from "@/components/subscribe-options";
import { Footer } from "@/components/layout/footer";

type CartItemWithProduct = RetailCartItem & { retailProduct: ShopProduct };

const flavorInStock = (f: Flavor) => !(f as Flavor & { soldOut?: boolean }).soldOut;

/**
 * Flavor page of the flavor-first shop (owner, 2026-09-12): the customer arrived
 * having chosen a FLAVOR; here they choose the package it comes in (step 1), then
 * one-time vs subscription (step 2). Sold-through packages fall off the list —
 * the grid's "Available in" chips already told the story. Adding to cart submits
 * the same (retailProductId, selectedFlavorId) pairs as the old product pages.
 */
export default function ShopFlavor() {
  const { flavorId } = useParams<{ flavorId: string }>();
  const { toast } = useToast();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [added, setAdded] = useState(false);
  const [imageIndex, setImageIndex] = useState(0);
  // The Mixed page's split choice (same mechanics as the old Mixed card):
  // "a little of everything" is the plain Mixed flavor; "pick 2" is a split.
  const [pickTwo, setPickTwo] = useState(false);
  const [pickTwoA, setPickTwoA] = useState("");
  const [pickTwoB, setPickTwoB] = useState("");

  // Navigating flavor-to-flavor reuses this mounted component (same route), so
  // per-flavor choices must not leak from one flavor to the next.
  useEffect(() => {
    setSelectedProductId(null);
    setAdded(false);
    setImageIndex(0);
    setPickTwo(false);
    setPickTwoA("");
    setPickTwoB("");
  }, [flavorId]);

  const { data: flavors, isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });
  const { data: products, isLoading: productsLoading } = useQuery<ShopProduct[]>({
    queryKey: ["/api/retail-products"],
  });
  const { data: cartItems = [] } = useQuery<CartItemWithProduct[]>({
    queryKey: ["/api/retail-cart"],
  });
  const isLoading = flavorsLoading || productsLoading;

  const hasSubscriptionItems = cartItems.some((item) => item.isSubscription);
  const hasOneTimeItems = cartItems.some((item) => !item.isSubscription);

  const flavor = flavors?.find((f) => f.id === flavorId);
  const packages: FlavorPackage[] = flavor ? packagesForFlavor(flavor, products ?? []).filter((p) => p.available) : [];
  const chosen = packages.find((p) => p.product.id === selectedProductId) ?? packages[0] ?? null;
  const product = chosen?.product ?? null;

  const isMixed = flavor?.name === "Mixed";
  const splitCapable = isMixed && !!product && product.productType === "multi-flavor" && !!(product as ShopProduct & { allowSplit?: boolean }).allowSplit;
  const splitOn = splitCapable && pickTwo;
  const splitReady = !!pickTwoA && !!pickTwoB && pickTwoA !== pickTwoB;
  const flavorsIncomplete = splitOn && !splitReady;

  // What actually goes in the cart: single-flavor products carry their own flavor;
  // multi-flavor products need the page's flavor named (or the two split picks).
  const addFlavorId = product?.productType === "multi-flavor" ? (splitOn ? pickTwoA : flavor?.id) : undefined;
  const addSplitId = splitOn ? pickTwoB : undefined;

  const addToCartMutation = useMutation({
    mutationFn: async (vars: { isSubscription: boolean; subscriptionFrequency?: string }) => {
      await apiRequest("POST", "/api/retail-cart", {
        retailProductId: product!.id,
        selectedFlavorId: addFlavorId,
        splitFlavorId: addSplitId,
        quantity: 1,
        isSubscription: vars.isSubscription,
        subscriptionFrequency: vars.subscriptionFrequency,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/retail-cart"] });
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
      toast({ title: "Added to cart", description: "Item successfully added to your cart" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to add item to cart", variant: "destructive" });
    },
  });

  const oneTimePurchase = () => {
    if (hasSubscriptionItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your subscription order first, or remove subscription items from your cart.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({ isSubscription: false });
  };

  const subscriptionPurchase = (frequency: string) => {
    if (hasOneTimeItems) {
      toast({
        title: "Cannot mix order types",
        description: "One-time and subscription products must be purchased separately. Please complete your one-time order first, or remove one-time items from your cart.",
        variant: "destructive",
      });
      return;
    }
    addToCartMutation.mutate({ isSubscription: true, subscriptionFrequency: frequency });
  };

  const requireFlavors = () =>
    toast({
      title: "Pick your two flavors",
      description: "Choose two different flavors for the split case above",
      variant: "destructive",
    });

  if (!isLoading && !flavor) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-3">Flavor not found</h1>
          <Button asChild variant="outline"><Link href="/shop">Back to the shop</Link></Button>
        </div>
        <Footer />
      </div>
    );
  }

  const images = flavor ? ([flavor.primaryImageUrl, flavor.secondaryImageUrl].filter(Boolean) as string[]) : [];
  const accent = flavor ? FLAVOR_ACCENTS[flavor.name] : undefined;
  const canSubscribe = product != null && Number(product.subscriptionDiscount ?? 0) > 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <Link href="/shop" className="inline-flex items-center gap-1.5 text-sm font-medium text-cedar mb-6" data-testid="link-back-to-shop">
          <ArrowLeft className="w-4 h-4" /> All flavors
        </Link>

        {isLoading && <p className="text-muted-foreground py-12" data-testid="text-flavor-loading">Loading...</p>}

        {flavor && (
          <>
            <div className="grid md:grid-cols-2 gap-8 md:gap-12 items-center">
              <div>
                <div className="bg-card border rounded-md p-4 flex items-center justify-center">
                  {images.length > 0 ? (
                    <img
                      src={images[imageIndex]}
                      alt={`${flavor.name} kombucha`}
                      className="max-h-[22rem] w-auto max-w-full object-contain"
                      data-testid={`image-flavor-${flavor.id}`}
                    />
                  ) : (
                    <div className="h-64" />
                  )}
                </div>
                {images.length > 1 && (
                  <div className="flex justify-center gap-2 mt-3">
                    {images.map((_, idx) => (
                      <button
                        key={idx}
                        onClick={() => setImageIndex(idx)}
                        className={`w-2.5 h-2.5 rounded-full transition-all ${idx === imageIndex ? "bg-primary" : "bg-muted-foreground/30"}`}
                        aria-label={`Photo ${idx + 1}`}
                        data-testid={`button-image-dot-${idx}`}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div>
                {flavor.flavorProfile && (
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar mb-2" data-testid="text-flavor-profile">
                    {flavor.flavorProfile}
                  </p>
                )}
                <h1
                  className="text-4xl md:text-5xl font-bold uppercase tracking-[0.1em] leading-tight"
                  style={{ color: accent }}
                  data-testid="text-flavor-name"
                >
                  {flavorOptionLabel(flavor.name)}
                </h1>
                <p className="mt-4 text-foreground/90 leading-relaxed" data-testid="text-flavor-description">{flavor.description}</p>
                {flavor.ingredients?.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground" data-testid="text-flavor-ingredients">
                    <span className="font-medium text-foreground/80">Ingredients:</span> {flavor.ingredients.join(", ")}
                  </p>
                )}
              </div>
            </div>

            {packages.length === 0 ? (
              <div className="mt-10 rounded-md border bg-muted/40 p-6 text-center" data-testid="text-flavor-soldout">
                <p className="font-medium">That's the last of it — {flavor.name} is sold through for now.</p>
                <Button asChild variant="outline" className="mt-4"><Link href="/shop">See what's pouring</Link></Button>
              </div>
            ) : (
              <div className="mt-10 max-w-2xl">
                <h2 className="font-semibold text-lg mb-3">Choose your package</h2>
                <div className="grid sm:grid-cols-2 gap-3" data-testid="grid-packages">
                  {packages.map(({ product: p }) => {
                    const selected = product?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => { setSelectedProductId(p.id); setAdded(false); }}
                        className={`text-left rounded-md border p-4 bg-card transition-colors ${selected ? "border-primary ring-1 ring-primary" : "hover:border-primary/50"}`}
                        data-testid={`button-package-${p.id}`}
                      >
                        <p className="font-semibold">{p.productName || p.unitType.replace(/-/g, " ")}</p>
                        {p.unitDescription && <p className="text-xs text-muted-foreground mt-0.5">{p.unitDescription}</p>}
                        <p className="font-bold mt-2" data-testid={`text-package-price-${p.id}`}>
                          ${parseFloat(p.price).toFixed(2)}
                          {p.deposit && Number(p.deposit) > 0 && (
                            <span className="font-normal text-xs text-muted-foreground"> + ${parseFloat(p.deposit).toFixed(2)} refundable deposit</span>
                          )}
                        </p>
                        {Number(p.subscriptionDiscount ?? 0) > 0 && (
                          <Badge variant="default" className="text-xs mt-2">Subscribe &amp; Save {Number(p.subscriptionDiscount).toFixed(0)}%</Badge>
                        )}
                      </button>
                    );
                  })}
                </div>

                {splitCapable && (
                  <div className="mt-5">
                    <div className="grid grid-cols-2 gap-2 max-w-md" role="radiogroup" aria-label="Mixed case style">
                      <Button type="button" size="sm" variant={splitOn ? "outline" : "secondary"} onClick={() => setPickTwo(false)} data-testid="button-mixed-all">
                        A little of everything
                      </Button>
                      <Button type="button" size="sm" variant={splitOn ? "secondary" : "outline"} onClick={() => setPickTwo(true)} data-testid="button-mixed-pick2">
                        Pick 2 flavors
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {splitOn ? "6 bottles of each flavor you pick." : "2 bottles of each flavor."}
                    </p>
                    {splitOn && product && (
                      <div className="grid grid-cols-2 gap-2 mt-2 max-w-md">
                        <div>
                          <Label className="text-xs text-muted-foreground">First flavor</Label>
                          <Select value={pickTwoA} onValueChange={setPickTwoA}>
                            <SelectTrigger data-testid="select-pick2-a" className="mt-1"><SelectValue placeholder="First flavor" /></SelectTrigger>
                            <SelectContent>
                              {product.flavors.filter((f) => f.isActive && flavorInStock(f) && f.name !== "Mixed" && f.id !== pickTwoB).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Second flavor</Label>
                          <Select value={pickTwoB} onValueChange={setPickTwoB}>
                            <SelectTrigger data-testid="select-pick2-b" className="mt-1"><SelectValue placeholder="Second flavor" /></SelectTrigger>
                            <SelectContent>
                              {product.flavors.filter((f) => f.isActive && flavorInStock(f) && f.name !== "Mixed" && f.id !== pickTwoA).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <h2 className="font-semibold text-lg mt-8 mb-3">One-time, or on a schedule?</h2>
                {canSubscribe ? (
                  <Tabs defaultValue={hasSubscriptionItems ? "subscribe" : "one-time"} className="max-w-md">
                    {/* Same pattern as the old shop: tabs stay clickable even when the
                        cart blocks that order type — the panel explains the rule. */}
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="one-time" data-testid="tab-one-time">One-time</TabsTrigger>
                      <TabsTrigger value="subscribe" data-testid="tab-subscribe">Subscribe</TabsTrigger>
                    </TabsList>
                    <TabsContent value="one-time" className="mt-2">
                      {hasSubscriptionItems ? (
                        <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                          Your cart has a subscription. Check out first, then one-time items can go in your next order.
                        </div>
                      ) : (
                        <Button
                          onClick={() => (flavorsIncomplete ? requireFlavors() : oneTimePurchase())}
                          disabled={addToCartMutation.isPending || added || flavorsIncomplete}
                          className="w-full"
                          data-testid="button-add-one-time"
                        >
                          {added ? (<><Check className="w-4 h-4 mr-2" />Added</>) : (<><ShoppingCart className="w-4 h-4 mr-2" />Add to Cart — ${product ? parseFloat(product.price).toFixed(2) : ""}</>)}
                        </Button>
                      )}
                    </TabsContent>
                    <TabsContent value="subscribe" className="mt-2 space-y-2">
                      {hasOneTimeItems ? (
                        <div className="text-sm text-muted-foreground rounded-md border bg-muted/40 p-3">
                          Your cart has one-time items. Check those out first, then start a subscription — the two are ordered separately.
                        </div>
                      ) : (
                        product && (
                          <SubscribeOptions
                            price={product.price}
                            subscriptionDiscount={product.subscriptionDiscount}
                            disabled={addToCartMutation.isPending || flavorsIncomplete}
                            testIdPrefix={product.id}
                            onSelect={(frequency) => (flavorsIncomplete ? requireFlavors() : subscriptionPurchase(frequency))}
                          />
                        )
                      )}
                    </TabsContent>
                  </Tabs>
                ) : (
                  <div className="max-w-md">
                    <Button
                      onClick={() => (flavorsIncomplete ? requireFlavors() : oneTimePurchase())}
                      disabled={addToCartMutation.isPending || added || flavorsIncomplete}
                      className="w-full"
                      data-testid="button-add-one-time"
                    >
                      {added ? (<><Check className="w-4 h-4 mr-2" />Added</>) : (<><ShoppingCart className="w-4 h-4 mr-2" />Add to Cart — ${product ? parseFloat(product.price).toFixed(2) : ""}</>)}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">Kegs are one-time purchases.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
