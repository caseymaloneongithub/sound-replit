import { useState } from "react";
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
  const [weekOffset, setWeekOffset] = useState(0);
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/staff/orders-board", weekOffset] });
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
        {/* Week navigation — large touch targets for a tablet */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-board-title">Orders Board</h1>
            <p className="text-lg text-muted-foreground">
              {weekName}{weekOffset !== 0 && weekLabel ? ` · ${weekLabel}` : ""}
            </p>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-sky-500" />Retail pickup</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-violet-500" />Wholesale delivery</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="lg" className="h-14 w-14" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-prev-week" aria-label="Previous week">
              <ChevronLeft className="h-6 w-6" />
            </Button>
            <Button variant={weekOffset === 0 ? "secondary" : "outline"} size="lg" className="h-14 px-5 text-base" onClick={() => setWeekOffset(0)} data-testid="button-this-week">
              Today
            </Button>
            <Button variant="outline" size="lg" className="h-14 w-14" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-next-week" aria-label="Next week">
              <ChevronRight className="h-6 w-6" />
            </Button>
            <Button variant="ghost" size="lg" className="h-14 w-14" onClick={() => refetch()} aria-label="Refresh now" data-testid="button-refresh">
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
              <div className="grid gap-6 sm:grid-cols-2">
                <SummaryColumn title="Retail pickups" items={data!.totals.retail} />
                <SummaryColumn title="Wholesale deliveries" items={data!.totals.wholesale} />
              </div>
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

function SummaryColumn({ title, items }: { title: string; items: BoardItem[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-2">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.label} className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums w-12 text-right">{it.quantity}</span>
              <span className="text-base">{it.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
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
