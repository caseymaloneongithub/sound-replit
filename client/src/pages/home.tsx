import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import type { Flavor } from "@shared/schema";
import { Button } from "@/components/ui/button";
import fishermensTerminal from "@assets/stock_images/fishermens_terminal_ballard.jpg"; // Fishermen's Terminal, Ballard (Unsplash, free commercial use)
import logo from "@assets/text-stacked-black_1762299663824.png";
import { Footer } from "@/components/layout/footer";
import { useAuth } from "@/hooks/use-auth";

// "Mixed" is the variety-pack pseudo-flavor the shop uses for assorted cases. It is a real
// row in `flavors` so products can reference it, but it isn't a flavor anyone drinks, so
// the roundup leaves it out.
const VARIETY_PSEUDO_FLAVORS = new Set(["Mixed"]);

export default function Home() {
  // Drives the two audience lanes: a signed-in wholesale customer gets reorder shortcuts,
  // a signed-in retail customer gets their subscription, everyone else gets the two doors.
  const { user } = useAuth();

  const { data: flavors, isLoading } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });

  const roundup = (flavors ?? [])
    .filter((f) => f.isActive && !VARIETY_PSEUDO_FLAVORS.has(f.name))
    .sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <div className="min-h-screen bg-background">
      <div
        className="relative h-96 bg-cover bg-center flex items-center justify-center"
        style={{ backgroundImage: `linear-gradient(rgba(20, 50, 60, 0.45), rgba(20, 50, 60, 0.6)), url(${fishermensTerminal})` }}
      >
        <div className="text-center text-white px-4">
          <img
            src={logo}
            alt="Puget Sound Kombucha Co."
            className="h-48 mx-auto"
            style={{ filter: "brightness(0) invert(1)" }}
          />
        </div>
      </div>

      {/* Who are you, and what should you do here? Two lanes — trade and home — each with
          the one or two actions that matter, and each aware of whether you're already a
          customer. */}
      <div className="bg-muted/50 py-10">
        <div className="container mx-auto px-4 grid gap-6 md:grid-cols-2 max-w-5xl">
          {/* Trade lane */}
          <div className="bg-card border border-card-border rounded-lg p-6 flex flex-col shadow-[0_10px_24px_-16px_hsl(189_56%_27%/0.35)]" data-testid="lane-wholesale">
            <p className="text-xs font-semibold tracking-wider uppercase text-cedar">For shops, cafés &amp; restaurants</p>
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
                  Cases and kegs, delivered or picked up &mdash; no account needed.
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
          <div className="bg-card border border-card-border rounded-lg p-6 flex flex-col shadow-[0_10px_24px_-16px_hsl(189_56%_27%/0.35)]" data-testid="lane-retail">
            <p className="text-xs font-semibold tracking-wider uppercase text-cedar">For your fridge</p>
            {user && user.role !== "wholesale_customer" ? (
              <>
                <h2 className="text-2xl font-bold mt-2">Retail orders</h2>
                <p className="text-muted-foreground mt-1 flex-1">Shop 12-packs and kegs, or manage your Subscribe &amp; Save deliveries.</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-shop">
                    <Link href="/shop">Shop kombucha</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-account">
                    <Link href="/my-account">My subscription</Link>
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-bold mt-2">Public pickup orders</h2>
                <p className="text-muted-foreground mt-1 flex-1">
                  Pick up at the brewery in Ballard, Mon&ndash;Thu. Subscribe &amp; Save 10% on a standing order you can skip or pause any time.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-shop">
                    <Link href="/shop">Shop kombucha</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-subscribe">
                    <Link href="/shop">Subscribe &amp; Save</Link>
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Flavor roundup */}
      <section id="flavors" className="container mx-auto px-4 py-12 scroll-mt-4">
        <div className="max-w-2xl mb-10">
          <h2 className="text-3xl font-bold mb-2" data-testid="text-flavors-title">Our flavors</h2>
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

      {/* Closing doors — same two actions as the lanes, for people who read to the bottom. */}
      <div className="bg-muted/50 py-12">
        <div className="container mx-auto px-4 text-center max-w-2xl">
          <h2 className="text-2xl font-bold mb-2">Ready to try them?</h2>
          <p className="text-muted-foreground mb-6">Order 12-packs and kegs for pickup in Ballard, or bring Puget Sound Kombucha to your shop.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild size="lg" data-testid="button-cta-shop">
              <Link href="/shop">Shop kombucha</Link>
            </Button>
            <Button asChild size="lg" variant="outline" data-testid="button-cta-wholesale">
              <Link href="/wholesale/apply">Apply for a wholesale account</Link>
            </Button>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
