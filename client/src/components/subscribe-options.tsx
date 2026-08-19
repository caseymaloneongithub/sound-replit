import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import {
  FREQUENCY_OPTIONS,
  type SubscriptionFrequency,
} from "@shared/subscription-frequency";

interface SubscribeOptionsProps {
  /** Undiscounted catalogue price, as stored (e.g. "40.00"). */
  price: string;
  /** Percent off for subscribing, as stored (e.g. "10.00"). */
  subscriptionDiscount?: string | number | null;
  disabled?: boolean;
  onSelect: (frequency: SubscriptionFrequency) => void;
  /** Prefix for data-testid, so callers keep stable per-product ids. */
  testIdPrefix?: string;
}

/**
 * The Subscribe & Save offer, shared by the shop grid and the product detail page.
 *
 * These two surfaces used to present the same offer differently: the shop showed the
 * discounted price prominently but only three hardcoded cadences with bespoke labels
 * ("Monthly" for every-4-weeks), while product detail showed five cadences but no
 * price. Cadences and labels now come from the shared frequency module, so the two can
 * never drift apart again.
 */
export function SubscribeOptions({
  price,
  subscriptionDiscount,
  disabled = false,
  onSelect,
  testIdPrefix = "subscribe",
}: SubscribeOptionsProps) {
  const discount = subscriptionDiscount ? Number(subscriptionDiscount) : 0;
  const base = parseFloat(price);
  const discounted = Number.isFinite(base) ? base * (1 - discount / 100) : 0;

  return (
    <div className="space-y-2">
      {discount > 0 && (
        // NOTE: this used `text-accent` on `bg-accent/10`, which in this theme resolves
        // to near-white on near-white (~1.1:1 contrast) — the headline was effectively
        // invisible. Uses foreground/muted tokens so it stays legible in both themes.
        <div className="text-center py-2 px-3 bg-muted rounded-md border">
          <p className="text-sm font-semibold text-foreground">
            Subscribe &amp; Save {discount.toFixed(0)}%
          </p>
          <p className="text-lg font-bold mt-1" data-testid={`text-subscription-price-${testIdPrefix}`}>
            ${discounted.toFixed(2)}
          </p>
          <p className="text-xs text-muted-foreground">
            per delivery &middot; cancel anytime
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {FREQUENCY_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant="outline"
            className="w-full"
            disabled={disabled}
            onClick={() => onSelect(opt.value)}
            data-testid={`button-subscribe-${opt.value}-${testIdPrefix}`}
          >
            <Plus className="w-4 h-4 mr-1 shrink-0" />
            <span className="truncate">{opt.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
