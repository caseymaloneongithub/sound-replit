import { useState } from "react";
import { Link } from "wouter";
import { usePendingLinkRequests } from "@/components/staff/contact-requests-panel";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { ChevronLeft, ChevronRight, RefreshCw, Eye, EyeOff } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { PICKUP_POLICY } from "@shared/pickup-policy";

const TZ = PICKUP_POLICY.timezone;

type BoardItem = { label: string; quantity: number };
type BoardOrder = {
  id: string;
  kind: "retail" | "wholesale";
  title: string;
  reference: string;
  tag: string | null;
  scheduledDate: string;
  status: string;
  total: string;
  items: BoardItem[];
};
type BoardData = {
  week: { mondayISO: string; startISO: string; endISO: string; offset: number };
  orders: BoardOrder[];
  totals: { retail: BoardItem[]; wholesale: BoardItem[] };
  stock?: Record<string, { quantity: number; productId: string } | null>;
  catalog?: Record<string, Array<{ flavor: string; quantity: number; productId: string }>>;
  counts: { retail: number; wholesale: number };
};

// Status progression per channel. Tapping the button advances to `next`; at the terminal
// state there's nothing to advance to (done). Kept here, next to the labels, so the board
// and the buttons can't disagree about what "next" means.
const FLOW: Record<BoardOrder["kind"], { order: string[]; labels: Record<string, string>; endpoint: (id: string) => string }> = {
  retail: {
    order: ["pending", "ready_for_pickup", "fulfilled"],
    labels: { pending: "Pending", ready_for_pickup: "Ready", fulfilled: "Picked up" },
    endpoint: (id) => `/api/retail/orders/${id}/status`,
  },
  wholesale: {
    order: ["pending", "packaged", "delivered"],
    labels: { pending: "Pending", packaged: "Packaged", delivered: "Delivered" },
    endpoint: (id) => `/api/wholesale/orders/${id}`,
  },
};

function nextStatus(o: BoardOrder): string | null {
  const flow = FLOW[o.kind];
  const i = flow.order.indexOf(o.status);
  if (i === -1 || i >= flow.order.length - 1) return null;
  return flow.order[i + 1];
}

function statusLabel(o: BoardOrder): string {
  return FLOW[o.kind].labels[o.status] ?? o.status;
}

export default function OrdersBoard() {
  const { toast } = useToast();
  // On Sunday the board looks ahead: the coming Monday-week is what the crew is
  // prepping, so "Today" lands there. (ISO day 7 = Sunday, Pacific.)
  const DEFAULT_OFFSET = formatInTimeZone(new Date(), TZ, "i") === "7" ? 1 : 0;
  const [weekOffset, setWeekOffset] = useState(DEFAULT_OFFSET);
  // Completed orders (retail picked up / wholesale delivered) are hidden by default so the
  // board shows only what still needs doing; the toggle brings them back for reference.
  const [showDone, setShowDone] = useState(false);

  const { data, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery<BoardData>({
    queryKey: ["/api/staff/orders-board", weekOffset],
    queryFn: () => apiRequest("GET", `/api/staff/orders-board?weekOffset=${weekOffset}`),
    // Auto-refresh: the board is meant to be left open on a wall tablet, so it pulls fresh
    // orders on its own without anyone touching it.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const advance = useMutation({
    mutationFn: async (o: BoardOrder) => {
      const next = nextStatus(o);
      if (!next) return;
      return apiRequest("PATCH", FLOW[o.kind].endpoint(o.id), { status: next });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff/orders-board", weekOffset] });
      // Delivery moves finished-goods stock; if that drove anything below zero (or a
      // line had no product to draw from), say so — but never block the tap.
      if (data?.stockWarnings?.length) {
        toast({ title: "Stock heads-up", description: data.stockWarnings.join(" · ") });
      }
    },
    onError: (e: any) => {
      toast({ title: "Couldn't update", description: e.message, variant: "destructive" });
    },
  });

  const week = data?.week;
  const weekLabel = week
    ? `${formatInTimeZone(new Date(week.startISO), TZ, "MMM d")} – ${formatInTimeZone(new Date(new Date(week.endISO).getTime() - 1), TZ, "MMM d")}`
    : "";
  const weekName = weekOffset === 0 ? "This week" : weekOffset === 1 ? "Next week" : weekOffset === -1 ? "Last week" : weekLabel;

  const { data: pendingRequests } = usePendingLinkRequests();
  const pendingCount = pendingRequests?.length ?? 0;

  const allOrders = data?.orders ?? [];
  const doneCount = allOrders.filter((o) => nextStatus(o) === null).length;
  const visibleOrders = showDone ? allOrders : allOrders.filter((o) => nextStatus(o) !== null);

  // Group orders by their Pacific calendar day for readability.
  const byDay = new Map<string, BoardOrder[]>();
  for (const o of visibleOrders) {
    const key = formatInTimeZone(new Date(o.scheduledDate), TZ, "yyyy-MM-dd");
    (byDay.get(key) ?? byDay.set(key, []).get(key)!).push(o);
  }
  const dayKeys = Array.from(byDay.keys()).sort();

  const totalItems = (data?.totals.retail.length ?? 0) + (data?.totals.wholesale.length ?? 0);

  return (
    <StaffLayout>
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        {pendingCount > 0 && (
          <Link href="/staff-portal/wholesale/customers" className="block rounded-md border bg-muted/50 px-4 py-3 text-base hover:bg-muted" data-testid="banner-contact-requests">
            <span className="font-semibold">{pendingCount} {pendingCount === 1 ? "person is" : "people are"} waiting to be connected to a store.</span>{" "}
            <span className="text-muted-foreground">Tap to review — approving also releases any order they built.</span>
          </Link>
        )}
        {/* Week navigation — large touch targets for a tablet */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-board-title">Orders Board</h1>
            <p className="text-lg text-muted-foreground">
              {weekName}{weekOffset !== 0 && weekLabel ? ` · ${weekLabel}` : ""}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-500" />Retail pickup</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-violet-500" />Wholesale delivery</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-prev-week" aria-label="Previous week">
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <Button variant={weekOffset === DEFAULT_OFFSET ? "secondary" : "outline"} size="sm" className="px-4" onClick={() => setWeekOffset(DEFAULT_OFFSET)} data-testid="button-this-week">
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-next-week" aria-label="Next week">
              <ChevronRight className="h-6 w-6" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Refresh now" data-testid="button-refresh">
              <RefreshCw className={`h-5 w-5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {/* Production summary — "what to make this week" */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-xl font-semibold">To prepare this week</h2>
              <span className="text-sm text-muted-foreground" data-testid="text-updated">
                {dataUpdatedAt ? `Updated ${formatInTimeZone(new Date(dataUpdatedAt), TZ, "h:mm a")}` : ""}
              </span>
            </div>
            {isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : totalItems === 0 ? (
              <p className="text-muted-foreground">Nothing scheduled this week.</p>
            ) : (
              <PrepGrid retail={data!.totals.retail} wholesale={data!.totals.wholesale} stock={data!.stock ?? {}} catalog={data!.catalog ?? {}} />
            )}
          </CardContent>
        </Card>

        {/* Show/hide completed orders */}
        {doneCount > 0 && (
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="lg"
              className="h-11"
              onClick={() => setShowDone((v) => !v)}
              data-testid="button-toggle-done"
            >
              {showDone ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
              {showDone ? "Hide" : "Show"} completed ({doneCount})
            </Button>
          </div>
        )}

        {/* Order list, grouped by day */}
        {!isLoading && dayKeys.length === 0 && (
          allOrders.length > 0 && !showDone ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-lg text-muted-foreground">All {allOrders.length} {allOrders.length === 1 ? "order" : "orders"} this week are completed. 🎉</p>
              <Button variant="outline" size="lg" onClick={() => setShowDone(true)} data-testid="button-show-completed">
                <Eye className="h-4 w-4 mr-2" />
                Show completed
              </Button>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-12 text-lg">No orders scheduled for {weekName.toLowerCase()}.</p>
          )
        )}

        {dayKeys.map((day) => (
          <div key={day} className="space-y-3">
            <h3 className="text-lg font-semibold sticky top-0 bg-background/95 py-2 z-10" data-testid={`day-${day}`}>
              {formatInTimeZone(new Date(`${day}T12:00:00`), TZ, "EEEE, MMM d")}
            </h3>
            <div className="grid gap-3 md:grid-cols-2">
              {byDay.get(day)!.map((o) => (
                <OrderCard key={`${o.kind}-${o.id}`} order={o} onAdvance={() => advance.mutate(o)} advancing={advance.isPending} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </StaffLayout>
  );
}

/**
 * The prepare-this-week pack sheet: one table PER UNIT TYPE, flavor columns,
 * Wholesale / Retail / Total rows, and In Stock (shelf count) under the total —
 * red when the shelf can't cover the week. Item labels arrive as "Flavor — Unit".
 */
function PrepGrid({ retail, wholesale, stock, catalog }: { retail: BoardItem[]; wholesale: BoardItem[]; stock: Record<string, { quantity: number; productId: string } | null>; catalog: Record<string, Array<{ flavor: string; quantity: number; productId: string }>> }) {
  const parse = (label: string) => {
    const idx = label.lastIndexOf(" — ");
    return idx === -1
      ? { flavor: label, unit: "Other" }
      : { flavor: label.slice(0, idx), unit: label.slice(idx + 3) };
  };

  // unit -> flavor -> { wholesale, retail, stock, productId }
  const units = new Map<string, Map<string, { wholesale: number; retail: number; stock: number | null; productId: string | null }>>();
  const add = (items: BoardItem[], channel: "wholesale" | "retail") => {
    for (const it of items) {
      const { flavor, unit } = parse(it.label);
      const flavors = units.get(unit) ?? new Map();
      const cell = flavors.get(flavor) ?? { wholesale: 0, retail: 0, stock: null, productId: null };
      cell[channel] += it.quantity;
      const entry = stock[it.label];
      if (cell.stock === null && entry != null) { cell.stock = entry.quantity; cell.productId = entry.productId; }
      flavors.set(flavor, cell);
      units.set(unit, flavors);
    }
  };
  add(wholesale, "wholesale");
  add(retail, "retail");

  // Every flavor shows, zeros included — but only for units that have SOME activity
  // this week (an all-zero unit table is noise, an all-zero flavor column is signal).
  for (const [unit, flavors] of Array.from(units.entries())) {
    for (const entry of catalog[unit] ?? []) {
      if (!flavors.has(entry.flavor)) {
        flavors.set(entry.flavor, { wholesale: 0, retail: 0, stock: entry.quantity, productId: entry.productId });
      }
    }
  }

  const unitGroups = Array.from(units.entries())
    .map(([unit, flavors]) => ({
      unit,
      columns: Array.from(flavors.entries())
        .map(([flavor, cell]) => ({ flavor, ...cell, total: cell.wholesale + cell.retail }))
        .sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) =>
      b.columns.reduce((sum, c) => sum + c.total, 0) - a.columns.reduce((sum, c) => sum + c.total, 0)
    );

  const dash = (n: number) => (n > 0 ? n : "—");

  return (
    <div className="space-y-6">
      {unitGroups.map((g) => {
        const sum = (key: "wholesale" | "retail" | "total") => g.columns.reduce((acc, c) => acc + c[key], 0);
        const stockSum = g.columns.every((c) => c.stock === null)
          ? null
          : g.columns.reduce((acc, c) => acc + (c.stock ?? 0), 0);
        return (
          <div key={g.unit} className="overflow-x-auto" data-testid={`prep-table-${g.unit}`}>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{g.unit}</div>
            <table className="w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="text-left font-medium text-muted-foreground py-2 pr-3 border-b w-28"></th>
                  {g.columns.map((c) => (
                    <th key={c.flavor} className="px-3 py-2 text-center font-medium border-b whitespace-nowrap">{c.flavor}</th>
                  ))}
                  <th className="px-3 py-2 text-center font-semibold border-b">All</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-violet-500 mr-2" aria-hidden />Wholesale
                  </td>
                  {g.columns.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-lg">{dash(c.wholesale)}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg font-semibold">{dash(sum("wholesale"))}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-2" aria-hidden />Retail
                  </td>
                  {g.columns.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-lg">{dash(c.retail)}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg font-semibold">{dash(sum("retail"))}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 pr-3 border-t">Total</td>
                  {g.columns.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-lg border-t">{dash(c.total)}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg border-t">{sum("total")}</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-2 pr-3 whitespace-nowrap">In Stock</td>
                  {g.columns.map((c, i) => (
                    <td key={i} className={`px-3 py-2 text-center text-lg ${c.stock !== null && c.stock < c.total ? "text-destructive font-semibold" : ""}`}>
                      {c.productId ? <StockCell productId={c.productId} quantity={c.stock ?? 0} /> : (c.stock === null ? "—" : c.stock)}
                    </td>
                  ))}
                  <td className={`px-3 py-2 text-center text-lg ${stockSum !== null && stockSum < sum("total") ? "text-destructive font-semibold" : ""}`}>
                    {stockSum === null ? "—" : stockSum}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// In-place shelf-count editing on the board (same field the inventory dashboard
// edits). Tap the number, type the count, save — big targets for the wall tablet.
function StockCell({ productId, quantity }: { productId: string; quantity: number }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(quantity));
  const save = useMutation({
    mutationFn: async () => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("bad value");
      return apiRequest("PATCH", `/api/inventory/${productId}`, { stockQuantity: Math.round(n) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff/orders-board"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/finished-goods"] });
      setEditing(false);
    },
  });
  if (editing) {
    return (
      <input
        autoFocus
        inputMode="numeric"
        className="w-16 rounded border bg-background px-1.5 py-1 text-center tabular-nums text-lg"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={() => save.mutate()}
        onKeyDown={(e) => {
          if (e.key === "Enter") save.mutate();
          if (e.key === "Escape") { setEditing(false); setValue(String(quantity)); }
        }}
        data-testid={`board-stock-input-${productId}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setValue(String(quantity)); setEditing(true); }}
      className="underline decoration-dotted underline-offset-4 hover:text-primary tabular-nums"
      title="Tap to set the count"
      data-testid={`board-stock-${productId}`}
    >
      {quantity}
    </button>
  );
}

// Channel is shown by colour, not a repeated badge: a coloured left edge + faint tint so
// you can tell retail from wholesale across the room. Legend at the top of the page.
const CHANNEL_CARD: Record<BoardOrder["kind"], string> = {
  retail: "border-l-4 border-l-sky-500 bg-sky-50/60 dark:bg-sky-950/30",
  wholesale: "border-l-4 border-l-violet-500 bg-violet-50/60 dark:bg-violet-950/30",
};

// Button colour tracks the CURRENT stage, so the action reads at a glance:
// amber = not started yet (get it going), green = last step (send it out the door).
function advanceButtonClass(status: string): string {
  return status === "pending"
    ? "bg-amber-500 hover:bg-amber-600 text-amber-950"
    : "bg-green-600 hover:bg-green-700 text-white";
}

function OrderCard({ order, onAdvance, advancing }: { order: BoardOrder; onAdvance: () => void; advancing: boolean }) {
  const next = nextStatus(order);
  const done = next === null;

  return (
    <Card className={`${CHANNEL_CARD[order.kind]} ${done ? "opacity-60" : ""}`} data-testid={`order-${order.id}`}>
      <CardContent className="pt-5">
        <div className="min-w-0">
          <p className="text-lg font-semibold truncate">{order.title}</p>
          {order.tag && <p className="text-sm text-muted-foreground">{order.tag}</p>}
        </div>

        <ul className="mt-3 space-y-0.5 text-sm">
          {order.items.map((it, i) => (
            <li key={i}>
              <span className="font-semibold tabular-nums">{it.quantity}×</span> {it.label}
            </li>
          ))}
        </ul>

        <div className="mt-4">
          {done ? (
            <div className="flex items-center justify-center gap-2 h-12 rounded-md bg-muted text-muted-foreground font-medium">
              {statusLabel(order)}
            </div>
          ) : (
            <Button
              className={`w-full h-14 text-base ${advanceButtonClass(order.status)}`}
              onClick={onAdvance}
              disabled={advancing}
              data-testid={`button-advance-${order.id}`}
            >
              {statusLabel(order)} → Mark {FLOW[order.kind].labels[next!]}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
