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

type BoardItem = { label: string; quantity: number; note?: string | null };
type BoardOrder = {
  id: string;
  kind: "retail" | "wholesale";
  title: string;
  reference: string;
  tag: string | null;
  scheduledDate: string;
  status: string;
  total: string;
  notes?: string | null;
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

// Two-letter column codes so headers never collide; the full name lives in the
// tooltip. Unmapped flavors fall back to their first two letters.
const FLAVOR_ABBR: Record<string, string> = {
  Evergreen: "EV",
  Hummingbrew: "HU",
  Mist: "MI",
  Bonfire: "BO",
  Northzest: "NZ",
  Wildberry: "WB",
  Sunbreak: "SB",
  "Island Hop": "IH",
  Mixed: "MX",
};
function flavorAbbr(flavor: string): string {
  return FLAVOR_ABBR[flavor] ?? flavor.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase();
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

  return (
    <StaffLayout>
      <div className="p-4 sm:p-6 max-w-full mx-auto space-y-5">
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
              <span className="text-sm" data-testid="text-updated">
                {dataUpdatedAt ? `Updated ${formatInTimeZone(new Date(dataUpdatedAt), TZ, "h:mm a")}` : ""}
              </span>
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
            {doneCount > 0 && (
              <Button variant="outline" size="sm" className="h-9" onClick={() => setShowDone((v) => !v)} data-testid="button-toggle-done">
                {showDone ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                {showDone ? "Hide" : "Show"} done ({doneCount})
              </Button>
            )}
          </div>
        </div>

        {/* Production summary — "what to make this week" */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="text-xl font-semibold mb-3">To prepare this week</h2>
            {isLoading ? (
              <p className="text-muted-foreground">Loading…</p>
            ) : (data?.totals.retail.length ?? 0) + (data?.totals.wholesale.length ?? 0) === 0 ? (
              <p className="text-muted-foreground">Nothing scheduled this week.</p>
            ) : (
              <PrepGrid retail={data!.totals.retail} wholesale={data!.totals.wholesale} stock={data!.stock ?? {}} catalog={data!.catalog ?? {}} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            {isLoading ? (
              <p className="text-muted-foreground py-8">Loading…</p>
            ) : allOrders.length === 0 ? (
              <p className="text-center text-muted-foreground py-12 text-lg">No orders scheduled for {weekName.toLowerCase()}.</p>
            ) : (
              <BoardSheet
                orders={allOrders}
                showDone={showDone}
                stock={data?.stock ?? {}}
                catalog={data?.catalog ?? {}}
                onAdvance={(o) => advance.mutate(o)}
                advancing={advance.isPending}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}

// Channel reads by colour on the order cell: a coloured left edge, same coding as the
// legend (sky = retail pickup, violet = wholesale delivery).
const CHANNEL_EDGE: Record<BoardOrder["kind"], string> = {
  retail: "border-l-4 border-l-sky-500",
  wholesale: "border-l-4 border-l-violet-500",
};

// Button colour tracks the CURRENT stage, so the action reads at a glance:
// amber = not started yet (get it going), green = last step (send it out the door).
function advanceButtonClass(status: string): string {
  return status === "pending"
    ? "bg-amber-500 hover:bg-amber-600 text-amber-950"
    : "bg-green-600 hover:bg-green-700 text-white";
}

/**
 * The whole week as one pack-sheet spreadsheet (owner, 2026-09-01, modeled on the
 * crew's old Excel): one row per order; columns sectioned by unit type, then flavor
 * (short codes from the old sheet); Total and editable In Stock rows at the bottom.
 * Item labels arrive as "Flavor — Unit".
 */
function BoardSheet({ orders, showDone, stock, catalog, onAdvance, advancing }: {
  orders: BoardOrder[];
  showDone: boolean;
  stock: Record<string, { quantity: number; productId: string } | null>;
  catalog: Record<string, Array<{ flavor: string; quantity: number; productId: string }>>;
  onAdvance: (o: BoardOrder) => void;
  advancing: boolean;
}) {
  const parse = (label: string) => {
    const idx = label.lastIndexOf(" — ");
    return idx === -1
      ? { flavor: label, unit: "Other" }
      : { flavor: label.slice(0, idx), unit: label.slice(idx + 3) };
  };

  // Column model: unit -> flavor -> weekly total, from the visible orders…
  const unitTotals = new Map<string, Map<string, number>>();
  for (const o of orders) {
    for (const it of o.items) {
      const { flavor, unit } = parse(it.label);
      const flavors = unitTotals.get(unit) ?? new Map<string, number>();
      flavors.set(flavor, (flavors.get(flavor) ?? 0) + it.quantity);
      unitTotals.set(unit, flavors);
    }
  }
  // …plus every catalog flavor (zeros included) for units that have SOME activity —
  // an all-zero unit section is noise, an all-zero flavor column is signal.
  for (const [unit, flavors] of Array.from(unitTotals.entries())) {
    for (const entry of catalog[unit] ?? []) {
      if (!flavors.has(entry.flavor)) flavors.set(entry.flavor, 0);
    }
  }

  // One flavor order shared by every section (ranked by combined weekly total),
  // matching the To Prepare tables above.
  const globalTotals = new Map<string, number>();
  for (const flavors of Array.from(unitTotals.values())) {
    for (const [flavor, total] of Array.from(flavors.entries())) {
      globalTotals.set(flavor, (globalTotals.get(flavor) ?? 0) + total);
    }
  }
  const flavorRank = Array.from(globalTotals.keys())
    .sort((a, b) => (globalTotals.get(b)! - globalTotals.get(a)!) || a.localeCompare(b));

  // Every section carries the FULL flavor set in the same order (like the old
  // Excel: MIX shows under kegs too, just empty) so sections stay comparable.
  const sections = Array.from(unitTotals.entries())
    .map(([unit, flavors]) => ({
      unit,
      flavors: flavorRank.map((flavor) => ({ flavor, total: flavors.get(flavor) ?? 0, offered: flavors.has(flavor) })),
      sectionTotal: Array.from(flavors.values()).reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => b.sectionTotal - a.sectionTotal);

  const qtyFor = (o: BoardOrder, unit: string, flavor: string) =>
    o.items.reduce((sum, it) => {
      const p = parse(it.label);
      return p.unit === unit && p.flavor === flavor ? sum + it.quantity : sum;
    }, 0);

  const rows = [...orders].sort((a, b) =>
    new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime() || a.title.localeCompare(b.title));
  // Open work on top, finished work below — the shelf only has to cover what's OPEN.
  const openRows = rows.filter((o) => nextStatus(o) !== null);
  const doneRows = rows.filter((o) => nextStatus(o) === null);
  const sumFor = (list: BoardOrder[], unit: string, flavor: string) =>
    list.reduce((sum, o) => sum + qtyFor(o, unit, flavor), 0);

  const flavorColCount = sections.reduce((a, s) => a + s.flavors.length, 0);
  const fullSpan = 2 + flavorColCount + 1;

  const notesFor = (o: BoardOrder) =>
    [o.notes, ...o.items.map((it) => it.note)].filter(Boolean).join(" · ");

  const dash = (n: number) => (n > 0 ? n : "");

  return (
    <div className="overflow-x-auto" data-testid="board-sheet">
      <table className="w-full table-fixed text-sm border-separate border-spacing-0">
        <colgroup>
          <col className="w-44" />
          <col className="w-24" />
          {sections.flatMap((s2) => s2.flavors.map((f) => <col key={`${s2.unit}|${f.flavor}`} />))}
          <col className="w-40" />
        </colgroup>
        <thead>
          <tr>
            <th className="border-b" colSpan={2}></th>
            {sections.map((s) => (
              <th
                key={s.unit}
                colSpan={s.flavors.length}
                className="px-2 py-1.5 text-center text-xs font-bold uppercase tracking-wider border-b border-l-2 bg-muted/50"
                data-testid={`section-${s.unit}`}
              >
                {s.unit}
              </th>
            ))}
            <th className="border-b border-l-2"></th>
          </tr>
          <tr className="text-xs text-muted-foreground">
            <th className="text-left font-medium py-1.5 pr-2 border-b">Order</th>
            <th className="text-left font-medium py-1.5 pr-3 border-b">Status</th>
            {sections.map((s) =>
              s.flavors.map((f, i) => (
                <th
                  key={`${s.unit}|${f.flavor}`}
                  title={f.flavor}
                  className={`px-1 py-1.5 text-center font-semibold border-b ${i === 0 ? "border-l-2" : "border-l border-border/40"}`}
                >
                  {flavorAbbr(f.flavor)}
                </th>
              ))
            )}
            <th className="px-2 py-1.5 text-left font-medium border-b border-l-2">Notes</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {openRows.length > 0 && (
            <tr>
              <td colSpan={fullSpan} className="pt-3 pb-1 pl-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Open orders</td>
            </tr>
          )}
          {openRows.map((o) => {
            const next = nextStatus(o);
            const done = next === null;
            return (
              <tr key={`${o.kind}-${o.id}`} className={done ? "opacity-50" : ""} data-testid={`order-${o.id}`}>
                <td className={`py-1.5 pr-2 pl-2 border-b ${CHANNEL_EDGE[o.kind]}`}>
                  {(() => {
                    const sep = o.title.indexOf(" — ");
                    const name = sep === -1 ? o.title : o.title.slice(0, sep);
                    const loc = sep === -1 ? null : o.title.slice(sep + 3);
                    return (
                      <>
                        <span className="text-xs font-medium">{name}</span>
                        {loc && <span className="block text-[11px] text-muted-foreground">{loc}</span>}
                        {/* City tags are noise here; keep only tags that change handling. */}
                        {o.tag && (o.kind === "retail" || o.tag === "Pickup at brewery") && (
                          <span className="block text-[11px] text-muted-foreground">{o.tag}</span>
                        )}
                      </>
                    );
                  })()}
                </td>
                <td className="py-1.5 pr-3 border-b whitespace-nowrap">
                  {done ? (
                    <span className="text-xs text-muted-foreground">{statusLabel(o)}</span>
                  ) : (
                    <Button
                      size="sm"
                      className={`h-7 px-2 text-[11px] ${advanceButtonClass(o.status)}`}
                      onClick={() => onAdvance(o)}
                      disabled={advancing}
                      title={`${statusLabel(o)} → Mark ${FLOW[o.kind].labels[next!]}`}
                      data-testid={`button-advance-${o.id}`}
                    >
                      → {FLOW[o.kind].labels[next!]}
                    </Button>
                  )}
                </td>
                {sections.map((s) =>
                  s.flavors.map((f, i) => {
                    const n = qtyFor(o, s.unit, f.flavor);
                    return (
                      <td key={`${s.unit}|${f.flavor}`} className={`px-1 py-1.5 text-center border-b ${i === 0 ? "border-l-2" : "border-l border-border/40"}`}>
                        {dash(n)}
                      </td>
                    );
                  })
                )}
                <td className="px-2 py-1.5 border-b border-l-2 text-xs text-muted-foreground">
                  <span className="line-clamp-2" title={notesFor(o)}>{notesFor(o)}</span>
                </td>
              </tr>
            );
          })}
          {/* The yellow totals row from the old sheet — OPEN work only, since that's
              what still has to leave the shelf. */}
          <tr className="font-bold bg-amber-100 dark:bg-amber-950/40">
            <td className="py-2 pr-2 pl-2" colSpan={2}>Open subtotal</td>
            {sections.map((s) =>
              s.flavors.map((f, i) => {
                const n = sumFor(openRows, s.unit, f.flavor);
                return (
                  <td key={`${s.unit}|${f.flavor}`} className={`px-1 py-2 text-center ${i === 0 ? "border-l-2" : "border-l border-border/40"}`}>
                    {!f.offered ? "" : n > 0 ? n : "—"}
                  </td>
                );
              })
            )}
            <td className="border-l-2"></td>
          </tr>
          <tr className="text-muted-foreground">
            <td className="py-2 pr-2 pl-2" colSpan={2}>In Stock</td>
            {sections.map((s) =>
              s.flavors.map((f, i) => {
                const catalogEntry = (catalog[s.unit] ?? []).find((e) => e.flavor === f.flavor);
                const entry = stock[`${f.flavor} — ${s.unit}`] ?? (catalogEntry ? { quantity: catalogEntry.quantity, productId: catalogEntry.productId } : null);
                const openNeed = sumFor(openRows, s.unit, f.flavor);
                const short = entry != null && entry.quantity < openNeed;
                return (
                  <td key={`${s.unit}|${f.flavor}`} className={`px-1 py-2 text-center ${i === 0 ? "border-l-2" : "border-l border-border/40"} ${short ? "text-destructive font-semibold" : ""}`}>
                    {entry ? <StockCell productId={entry.productId} quantity={entry.quantity} /> : f.offered ? "—" : ""}
                  </td>
                );
              })
            )}
            <td className="border-l-2"></td>
          </tr>

          {doneRows.length > 0 && (
            <>
              <tr>
                <td colSpan={fullSpan} className="pt-4 pb-1 pl-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Delivered &amp; picked up ({doneRows.length})
                </td>
              </tr>
              {showDone && doneRows.map((o) => (
                <tr key={`${o.kind}-${o.id}`} className="opacity-50" data-testid={`order-${o.id}`}>
                  <td className={`py-1.5 pr-2 pl-2 border-b ${CHANNEL_EDGE[o.kind]}`}>
                    <span className="text-xs font-medium">{o.title.split(" — ")[0]}</span>
                    {o.title.includes(" — ") && <span className="block text-[11px] text-muted-foreground">{o.title.slice(o.title.indexOf(" — ") + 3)}</span>}
                  </td>
                  <td className="py-1.5 pr-3 border-b whitespace-nowrap">
                    <span className="text-xs text-muted-foreground">{statusLabel(o)}</span>
                  </td>
                  {sections.map((s) =>
                    s.flavors.map((f, i) => (
                      <td key={`${s.unit}|${f.flavor}`} className={`px-1 py-1.5 text-center border-b ${i === 0 ? "border-l-2" : "border-l border-border/40"}`}>
                        {dash(qtyFor(o, s.unit, f.flavor))}
                      </td>
                    ))
                  )}
                  <td className="px-2 py-1.5 border-b border-l-2 text-xs text-muted-foreground">
                    <span className="line-clamp-2" title={notesFor(o)}>{notesFor(o)}</span>
                  </td>
                </tr>
              ))}
              <tr className="font-semibold text-muted-foreground">
                <td className="py-2 pr-2 pl-2" colSpan={2}>Delivered subtotal</td>
                {sections.map((s) =>
                  s.flavors.map((f, i) => {
                    const n = sumFor(doneRows, s.unit, f.flavor);
                    return (
                      <td key={`${s.unit}|${f.flavor}`} className={`px-1 py-2 text-center ${i === 0 ? "border-l-2" : "border-l border-border/40"}`}>
                        {!f.offered ? "" : n > 0 ? n : "—"}
                      </td>
                    );
                  })
                )}
                <td className="border-l-2"></td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </div>
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

  // ONE flavor order for every table (owner, 2026-09-01): ranked by combined weekly
  // total across all units, and every table shows the full flavor set — so the same
  // flavor sits in the same column in both tables and the columns line up.
  const globalTotals = new Map<string, number>();
  for (const flavors of Array.from(units.values())) {
    for (const [flavor, cell] of Array.from(flavors.entries())) {
      globalTotals.set(flavor, (globalTotals.get(flavor) ?? 0) + cell.wholesale + cell.retail);
    }
  }
  const flavorOrder = Array.from(globalTotals.keys())
    .sort((a, b) => (globalTotals.get(b)! - globalTotals.get(a)!) || a.localeCompare(b));

  const unitGroups = Array.from(units.entries())
    .map(([unit, flavors]) => ({
      unit,
      // `offered` = this unit actually sells the flavor (activity or catalog);
      // a padding column added purely for alignment renders BLANK, not dashed —
      // there is no such thing as a Mixed keg.
      columns: flavorOrder.map((flavor) => {
        const cell = flavors.get(flavor) ?? { wholesale: 0, retail: 0, stock: null, productId: null };
        return { flavor, ...cell, total: cell.wholesale + cell.retail, offered: flavors.has(flavor) };
      }),
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
            <table className="w-full text-sm border-separate border-spacing-0 table-fixed">
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
                    <td key={i} className="px-3 py-2 text-center text-lg">{c.offered ? dash(c.wholesale) : ""}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg font-semibold">{dash(sum("wholesale"))}</td>
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    <span className="inline-block w-2 h-2 rounded-full bg-sky-500 mr-2" aria-hidden />Retail
                  </td>
                  {g.columns.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-lg">{c.offered ? dash(c.retail) : ""}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg font-semibold">{dash(sum("retail"))}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 pr-3 border-t">Total</td>
                  {g.columns.map((c, i) => (
                    <td key={i} className="px-3 py-2 text-center text-lg border-t">{c.offered ? dash(c.total) : ""}</td>
                  ))}
                  <td className="px-3 py-2 text-center text-lg border-t">{sum("total")}</td>
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-2 pr-3 whitespace-nowrap">In Stock</td>
                  {g.columns.map((c, i) => (
                    <td key={i} className={`px-3 py-2 text-center text-lg ${c.stock !== null && c.stock < c.total ? "text-destructive font-semibold" : ""}`}>
                      {c.productId ? <StockCell productId={c.productId} quantity={c.stock ?? 0} /> : (!c.offered ? "" : c.stock === null ? "—" : c.stock)}
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
        className="w-14 rounded border bg-background px-1 py-0.5 text-center tabular-nums"
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
