import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import fishermensTerminal from "@assets/stock_images/fishermens_terminal_ballard.jpg"; // Fishermen's Terminal, Ballard (Unsplash, free commercial use)
import { Footer } from "@/components/layout/footer";
import { useAuth } from "@/hooks/use-auth";

// The can lineup (owner, 2026-09-10): ONE art-directed image of all six cans —
// saved as attached_assets/cans/lineup.png and served at /brand-assets/cans —
// referenced by URL so a missing file hides the section instead of breaking the build.
const CAN_LINEUP_URL = "/brand-assets/cans/lineup.webp";

export default function Home() {
  // Drives the two audience lanes: a signed-in wholesale customer gets reorder shortcuts,
  // a signed-in retail customer gets their subscription, everyone else gets the two doors.
  const { user } = useAuth();
  // The lineup section stays hidden until at least one can render actually loads.
  const [cansLoaded, setCansLoaded] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Hero (2026-09-09 redesign): the photograph carries it — the logo lives in the
          header now, so no more giant logo over a heavy overlay. Just a whisper of
          scrim at the bottom for the tagline. */}
      <div
        className="relative h-[32rem] bg-cover bg-center"
        style={{ backgroundImage: `url(${fishermensTerminal})` }}
        data-testid="hero"
      >
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 via-black/20 to-transparent">
          <div className="max-w-7xl mx-auto px-6 pb-10 pt-24 text-white">
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" data-testid="button-hero-shop">
                <Link href="/shop">Shop kombucha</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="bg-transparent border-white/70 text-white hover:bg-white/10 hover:text-white"
                data-testid="button-hero-flavors"
              >
                <Link href="/our-kombucha">Meet the flavors</Link>
              </Button>
            </div>
          </div>
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
                  Cases and kegs, delivered or picked up.
                </p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <Button asChild size="lg" data-testid="button-lane-wholesale-login">
                    <Link href="/wholesale/login">Order online</Link>
                  </Button>
                  <Button asChild size="lg" variant="outline" data-testid="button-lane-wholesale-apply">
                    <Link href="/wholesale/apply">Set up wholesale account</Link>
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
                <p className="text-muted-foreground mt-1 flex-1">Shop 12-packs and kegs, or manage your Subscribe &amp; Save pickups.</p>
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

      {/* The can lineup — a single wide image of all six cans, linking into Our
          Kombucha. Fully fluid (owner, 2026-09-10: no scrolling): the whole lineup
          is always visible and scales with the page. */}
      <section className={`py-14 px-4 ${cansLoaded ? "" : "hidden"}`} data-testid="section-can-lineup">
        <div className="text-center mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cedar">Now in cans</p>
        </div>
        <Link href="/our-kombucha" className="block max-w-5xl mx-auto" data-testid="link-can-lineup">
          {/* No loading="lazy": a lazy image inside the initially-hidden section
              would never fetch, so the section could never reveal itself. */}
          <img
            src={CAN_LINEUP_URL}
            alt="The six Puget Sound Kombucha flavors in cans: Sunbreak, Northzest, Wildberry, Bonfire, Island Hop, and Mist"
            className="w-full h-auto"
            onLoad={() => setCansLoaded(true)}
          />
        </Link>
        <p className="text-center mt-6">
          <Link href="/our-kombucha" className="text-sm font-semibold uppercase tracking-[0.2em] text-cedar hover:underline">
            Meet the flavors
          </Link>
        </p>
      </section>

      {/* Closing doors — same two actions as the lanes, for people who read to the bottom.
          The flavor roundup lives on /our-kombucha now (2026-09-09). */}
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
