import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Flavor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Footer } from "@/components/layout/footer";

// "Mixed" is the variety-pack pseudo-flavor the shop uses for assorted cases. It is a real
// row in `flavors` so products can reference it, but it isn't a flavor anyone drinks, so
// the roundup leaves it out.
const VARIETY_PSEUDO_FLAVORS = new Set(["Mixed"]);

/**
 * Our Kombucha (2026-09-09 redesign): the flavor roundup, moved off the homepage onto
 * its own page — the header's OUR KOMBUCHA destination.
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
        <div className="max-w-2xl mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar">Our kombucha</p>
          <h1 className="text-4xl font-bold mt-2 mb-3" data-testid="text-flavors-title">The flavors</h1>
          <p className="text-muted-foreground">
            Small-batch kombucha brewed in Seattle from real tea, fruit, herbs and spices.
          </p>
        </div>

        {isLoading && (
          <p className="text-muted-foreground py-8" data-testid="text-flavors-loading">Loading flavors...</p>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {roundup.map((flavor) => (
            <article key={flavor.id} className="flex flex-col" data-testid={`flavor-card-${flavor.id}`}>
              <div className="aspect-square overflow-hidden rounded-md bg-muted">
                {flavor.primaryImageUrl ? (
                  <img
                    src={flavor.primaryImageUrl}
                    alt={flavor.name}
                    loading="lazy"
                    className="w-full h-full object-cover"
                    data-testid={`flavor-image-${flavor.id}`}
                  />
                ) : null}
              </div>
              <h3 className="text-2xl font-semibold mt-4" data-testid={`flavor-name-${flavor.id}`}>{flavor.name}</h3>
              {flavor.flavorProfile && (
                <p className="text-sm font-medium uppercase tracking-wide text-cedar mt-1">{flavor.flavorProfile}</p>
              )}
              <p className="mt-3 text-foreground/90 leading-relaxed">{flavor.description}</p>
              {flavor.ingredients?.length > 0 && (
                <p className="mt-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground/80">Ingredients:</span> {flavor.ingredients.join(", ")}
                </p>
              )}
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
