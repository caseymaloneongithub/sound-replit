import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Flavor } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Image as ImageIcon } from "lucide-react";
import { flavorOptionLabel, FLAVOR_ACCENTS } from "@/lib/flavor-display";
import { packagesForFlavor, availabilityChips, type ShopProduct } from "@/lib/flavor-shop";
import fishermensTerminal from "@assets/stock_images/fishermens_terminal_ballard.jpg"; // Fishermen's Terminal, Ballard (Unsplash, free commercial use)
import logo from "@assets/text-stacked-black_1762299663824.png";
import { Footer } from "@/components/layout/footer";

/**
 * Flavor-first shop grid (owner, 2026-09-12, from the approved mockup): customers
 * pick a FLAVOR here; the flavor page then offers its packages (cans, bottles,
 * kegs) and one-time vs subscribe. Cards carry an "Available in" line so the
 * bottle sell-through reads as a packaging change, not a shrinking shop — a
 * flavor stays on the wall as long as anything remains, and a fully sold-through
 * flavor greys out instead of vanishing.
 */
export default function ShopFlavors() {
  const { data: flavors, isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });
  const { data: products, isLoading: productsLoading } = useQuery<ShopProduct[]>({
    queryKey: ["/api/retail-products"],
  });
  const isLoading = flavorsLoading || productsLoading;

  const rows = (flavors ?? [])
    .filter((f) => f.isActive)
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((flavor) => {
      const pkgs = packagesForFlavor(flavor, products ?? []);
      const chips = availabilityChips(pkgs);
      const availablePkgs = pkgs.filter((p) => p.available);
      const fromPrice = availablePkgs.length
        ? Math.min(...availablePkgs.map((p) => parseFloat(p.product.price)))
        : null;
      const bestDiscount = Math.max(
        0,
        ...availablePkgs.map((p) => Number(p.product.subscriptionDiscount ?? 0)),
      );
      return { flavor, pkgs, chips, fromPrice, bestDiscount, soldThrough: pkgs.length > 0 && availablePkgs.length === 0 };
    })
    // A flavor no product offers at all isn't for sale — leave it off the wall.
    .filter((row) => row.pkgs.length > 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Compact on phones (2026-09-11 review): the tall banner pushed the first
          card ~1,350px down at 390px wide. Flavors come first on mobile; the
          photographic banner stays for desktop. */}
      <div
        className="relative h-36 md:h-96 bg-cover bg-center flex items-center justify-center"
        style={{ backgroundImage: `linear-gradient(rgba(20, 50, 60, 0.45), rgba(20, 50, 60, 0.6)), url(${fishermensTerminal})` }}
      >
        <div className="text-center text-white px-4">
          <img
            src={logo}
            alt="Puget Sound Kombucha Co."
            className="h-20 md:h-48 mx-auto"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </div>
      </div>

      <div id="shop" className="container mx-auto px-4 py-8 scroll-mt-4">
        <div className="mb-6 md:mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar">Now in cans</p>
          <h2 className="text-2xl md:text-3xl font-bold mt-2 mb-2" data-testid="text-products-title">Pick Your Flavor</h2>

          {/* Pickup Location Notice */}
          <div className="bg-primary text-primary-foreground py-2 md:py-3 px-4 rounded-md mt-3 md:mt-4 inline-flex items-center gap-3 text-sm md:text-base">
            <div>
              <span className="font-semibold">Pickup Only at Our Ballard Location:</span>{" "}
              <span className="opacity-90">4501 Shilshole Ave NW, Seattle, WA 98107</span>
            </div>
          </div>
        </div>

        {isLoading && (
          <p className="text-muted-foreground py-12" data-testid="text-products-loading">Loading flavors...</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 items-start">
          {rows.map(({ flavor, chips, fromPrice, bestDiscount, soldThrough }) => {
            const displayName = flavorOptionLabel(flavor.name);
            const card = (
              <Card
                data-testid={`card-flavor-${flavor.id}`}
                className={`overflow-hidden h-full ${soldThrough ? "opacity-60" : "cursor-pointer hover-elevate"}`}
              >
                <div className="aspect-square bg-muted overflow-hidden">
                  {flavor.primaryImageUrl ? (
                    <img
                      src={flavor.primaryImageUrl}
                      alt={`${flavor.name} kombucha`}
                      loading="lazy"
                      className={`w-full h-full object-cover ${soldThrough ? "grayscale" : ""}`}
                      data-testid={`image-flavor-${flavor.id}`}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ImageIcon className="w-16 h-16 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <CardContent className="p-4">
                  <h3
                    className="text-xl font-bold uppercase tracking-[0.08em]"
                    style={{ color: FLAVOR_ACCENTS[flavor.name] }}
                    data-testid={`text-flavor-${flavor.id}`}
                  >
                    {displayName}
                  </h3>
                  {flavor.flavorProfile && (
                    <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground mt-0.5" data-testid={`text-profile-${flavor.id}`}>
                      {flavor.flavorProfile}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground mt-2 line-clamp-2" data-testid={`text-description-${flavor.id}`}>
                    {flavor.description}
                  </p>

                  {/* The "Available in" line (owner ask): which packages this flavor
                      comes in right now, with sold-through packages shown struck
                      rather than hidden so the transition is legible. */}
                  <div className="flex items-center gap-1.5 flex-wrap mt-3" data-testid={`chips-available-${flavor.id}`}>
                    <span className="text-xs font-medium text-muted-foreground">Available in:</span>
                    {chips.map(({ label, available }) => (
                      <Badge
                        key={label}
                        variant={available ? "secondary" : "outline"}
                        className={`text-xs ${available ? "" : "text-muted-foreground line-through"}`}
                      >
                        {label}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-baseline gap-2 mt-3">
                    {soldThrough ? (
                      <p className="text-sm font-medium text-muted-foreground" data-testid={`text-soldout-${flavor.id}`}>
                        That's the last of it — sold through for now
                      </p>
                    ) : (
                      <>
                        {fromPrice != null && (
                          <p className="text-lg font-bold" data-testid={`text-price-${flavor.id}`}>
                            From ${fromPrice.toFixed(2)}
                          </p>
                        )}
                        {bestDiscount > 0 && (
                          <Badge variant="default" className="text-xs">
                            Subscribe &amp; Save {bestDiscount.toFixed(0)}%
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
            return soldThrough ? (
              <div key={flavor.id}>{card}</div>
            ) : (
              <Link key={flavor.id} href={`/shop/${flavor.id}`} data-testid={`link-flavor-${flavor.id}`} className="block h-full">
                {card}
              </Link>
            );
          })}
        </div>
      </div>

      <Footer />
    </div>
  );
}
