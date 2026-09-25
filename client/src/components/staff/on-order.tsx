import {
  ORDER_COVERAGE_LABELS,
  onOrderDueText,
  type OnOrder,
  type OrderCoverageKey,
} from "@shared/material-health";

/*
 * Open purchase orders beside a material's stock (owner, 2026-09-24: "whether
 * outstanding purchase orders ... will satisfy any shortfalls in inventory,
 * while still differentiating from actual inventory" … "something
 * communicating that we're good pending delivery"). The visual language: solid
 * badges and plain numbers are what's on the shelf; sky text and dashed tags
 * are what's on order. The rule is orderCoverage in shared/material-health.ts,
 * worked out on the server.
 */

/** Under the on-hand figure: what's on order and when it's due, never added to it. */
export function OnOrderLine({ onOrder, unit, testId }: { onOrder: OnOrder; unit: string; testId?: string }) {
  return (
    <div className="text-xs text-sky-700 dark:text-sky-300 tabular-nums whitespace-nowrap" data-testid={testId}>
      +{onOrder.units.toLocaleString()} {unit} on order · {onOrderDueText(onOrder)}
    </div>
  );
}

const COVERAGE_STYLES: Record<OrderCoverageKey, string> = {
  covered: "border-emerald-600 text-emerald-700 dark:border-emerald-400 dark:text-emerald-300",
  "runs-out-first": "border-amber-600 text-amber-700 dark:border-amber-400 dark:text-amber-300",
  short: "border-red-600 text-red-700 dark:border-red-400 dark:text-red-300",
  "not-short": "border-sky-600 text-sky-700 dark:border-sky-400 dark:text-sky-300",
};

/**
 * Under the level badge of a material that's short: whether what's on order
 * takes care of it. Nothing for a material that isn't short (its on-order line
 * says enough).
 */
export function CoverageTag({ coverage, testId }: { coverage: OrderCoverageKey | null; testId?: string }) {
  if (!coverage || coverage === "not-short") return null;
  return (
    <div className="mt-1">
      <span
        className={`inline-flex items-center rounded-full border border-dashed px-2 py-0.5 text-xs font-medium whitespace-nowrap ${COVERAGE_STYLES[coverage]}`}
        data-testid={testId}
      >
        {ORDER_COVERAGE_LABELS[coverage]}
      </span>
    </div>
  );
}
