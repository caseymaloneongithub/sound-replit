import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Flavor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/layout/footer";

// "Mixed" is the variety-pack pseudo-flavor the shop uses for assorted cases. It is a real
// row in `flavors` so products can reference it, but it isn't a flavor anyone drinks, so
// the roundup leaves it out.
const VARIETY_PSEUDO_FLAVORS = new Set(["Mixed"]);

// Each flavor's display accent — the big name is set in its color, Camellia Grove style.
// Mid-tone hues so they hold on both light and dark grounds; unknown names fall back to
// the normal foreground.
const FLAVOR_ACCENTS: Record<string, string> = {
  Mist: "#5b7a94",
  Sunbreak: "#d97b16",
  Wildberry: "#9d3c6c",
  Bonfire: "#b5451f",
  "Island Hop": "#1f8a70",
  Evergreen: "#38684a",
  Hummingbrew: "#c25e6a",
  Northzest: "#7a8c1e",
};

/**
 * Our Kombucha (2026-09-09, second pass): alternating stack — each flavor gets a full
 * row with the can (or photo) on one side and its name writ large on the other, sides
 * swapping as you scroll. Hairline rules between rows.
 */
export default function OurKombucha() {
  const { data: flavors, isLoading } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });

  const roundup = (flavors ?? [])
    .filter((f) => f.isActive && !VARIETY_PSEUDO_FLAVORS.has(f.name))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="min-h-screen bg-background">
      <section className="container mx-auto px-4 py-12">
        <div className="max-w-2xl mx-auto text-center mb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar">Our kombucha</p>
          <h1 className="text-4xl font-bold mt-2 mb-3" data-testid="text-flavors-title">The flavors</h1>
          <p className="text-muted-foreground">
            Small-batch kombucha brewed in Seattle from real tea, fruit, herbs and spices.
          </p>
        </div>

        {isLoading && (
          <p className="text-muted-foreground py-8" data-testid="text-flavors-loading">Loading flavors...</p>
        )}

        <div className="max-w-5xl mx-auto divide-y divide-cedar/30">
          {roundup.map((flavor, i) => (
            <article
              key={flavor.id}
              className="grid md:grid-cols-2 items-center gap-8 md:gap-14 py-12 md:py-16"
              data-testid={`flavor-card-${flavor.id}`}
            >
              <div className={i % 2 === 1 ? "md:order-2" : undefined}>
                {flavor.primaryImageUrl && (
                  <img
                    src={flavor.primaryImageUrl}
                    alt={`${flavor.name} kombucha`}
                    loading="lazy"
                    className="mx-auto max-h-[24rem] w-auto max-w-full object-contain rounded-md"
                    data-testid={`flavor-image-${flavor.id}`}
                  />
                )}
              </div>
              <div className={i % 2 === 1 ? "md:order-1 md:text-right" : undefined}>
                {flavor.flavorProfile && (
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar mb-3">
                    {flavor.flavorProfile}
                  </p>
                )}
                <h2
                  className="text-4xl md:text-5xl font-bold uppercase tracking-[0.12em] leading-tight"
                  style={{ color: FLAVOR_ACCENTS[flavor.name] }}
                  data-testid={`flavor-name-${flavor.id}`}
                >
                  {flavor.name}
                </h2>
                <p className="mt-4 text-lg text-foreground/90 leading-relaxed">{flavor.description}</p>
                {flavor.ingredients?.length > 0 && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    <span className="font-medium text-foreground/80">Ingredients:</span> {flavor.ingredients.join(", ")}
                  </p>
                )}
                <Button
                  asChild
                  variant="outline"
                  className="mt-6 uppercase tracking-[0.2em] border-cedar/60 text-cedar hover:text-cedar"
                  data-testid={`button-shop-flavor-${flavor.id}`}
                >
                  <Link href="/shop">Find it in the shop</Link>
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <div className="bg-muted/50 py-12">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-2xl font-bold mb-2">Ready to try them?</h2>
          <p className="text-muted-foreground mb-6">Order 12-packs and kegs for pickup in Ballard, or bring Puget Sound Kombucha to your shop.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="lg" data-testid="button-cta-shop">
              <Link href="/shop">Shop kombucha</Link>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="button-cta-wholesale">
              <Link href="/wholesale/apply">Set up wholesale account</Link>
            </Button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
