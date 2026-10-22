import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { WholesaleOrder, RetailSubscription, WholesaleCustomer } from "@shared/schema";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { startOfDay, subMonths } from "date-fns";

// ---- Revenue shares -------------------------------------------------------------
// One rule for every share pie on this page (owner, 2026-10-16/22): the entries of a
// period sorted by value, anything under 1% of the total pooled into one Other slice,
// slices of 5% and more labelled on the pie, and a list beside or below it naming
// every slice with its dollars, count and share.

const PERIODS = [
  { value: '3', label: 'Last 3 months' },
  { value: '6', label: 'Last 6 months' },
  { value: '9', label: 'Last 9 months' },
  { value: '12', label: 'Last 12 months' },
  { value: 'all', label: 'All time' },
] as const;
type Period = (typeof PERIODS)[number]['value'];
const OTHER_BELOW_SHARE = 0.01;
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#6366f1',
  '#84cc16', '#ec4899', '#06b6d4', '#a855f7', '#eab308', '#22c55e', '#0ea5e9', '#d946ef',
];
const OTHER_COLOR = '#94a3b8';
const money0 = (v: number) => `$${Math.round(v).toLocaleString()}`;

type ShareEntry = { key: string; name: string; value: number; count: number };
type Slice = ShareEntry & { share: string; color: string };

function toShares(entries: ShareEntry[], otherNoun: [string, string]): Slice[] {
  const total = entries.reduce((s, e) => s + e.value, 0);
  if (total <= 0) return [];
  const sorted = entries
    .filter(e => e.value > 0)
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const share = (value: number) => (100 * value / total).toFixed(1);
  const slices: Slice[] = sorted
    .filter(e => e.value / total >= OTHER_BELOW_SHARE)
    .map((e, i) => ({ ...e, share: share(e.value), color: PALETTE[i % PALETTE.length] }));
  const small = sorted.filter(e => e.value / total < OTHER_BELOW_SHARE);
  if (small.length > 0) {
    const value = small.reduce((s, e) => s + e.value, 0);
    slices.push({
      key: 'other',
      name: `Other (${small.length} ${small.length === 1 ? otherNoun[0] : otherNoun[1]})`,
      value,
      count: small.reduce((s, e) => s + e.count, 0),
      share: share(value),
      color: OTHER_COLOR,
    });
  }
  return slices;
}

/** A pie of shares with the list that names every slice. */
function SharePie({ slices, countNoun, layout, testId, empty }: {
  slices: Slice[];
  countNoun: [string, string];
  layout: 'side' | 'stack';
  testId: string;
  empty: string;
}) {
  if (slices.length === 0) {
    return <p className="text-muted-foreground text-sm py-12 text-center">{empty}</p>;
  }
  const noun = (n: number) => (n === 1 ? countNoun[0] : countNoun[1]);
  return (
    <div className={layout === 'side' ? 'grid gap-6 md:grid-cols-2 items-center' : 'space-y-3'}>
      <ResponsiveContainer width="100%" height={layout === 'side' ? 300 : 240}>
        <PieChart>
          <Pie
            data={slices}
            cx="50%"
            cy="50%"
            labelLine={false}
            // Only slices big enough to carry a label get one; the list names the rest.
            label={(p: any) => (p.percent >= 0.05 ? `${p.name} ${Math.round(p.percent * 100)}%` : null)}
            outerRadius={layout === 'side' ? 100 : 80}
            dataKey="value"
            nameKey="name"
          >
            {slices.map((s) => (
              <Cell key={s.key} fill={s.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v: number, name: string, item: any) => {
              const n = Number(item?.payload?.count ?? 0);
              return [`${money0(v)} · ${n} ${noun(n)}`, name];
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      <ul className="space-y-0.5 text-sm max-h-72 overflow-y-auto pr-1" data-testid={testId}>
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-3 py-1" data-testid={`${testId}-${s.key}`}>
            <span className="flex items-center gap-2 min-w-0">
              <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="tabular-nums text-muted-foreground whitespace-nowrap">
              {money0(s.value)} · {s.count} {noun(s.count)} · {s.share}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The packaging a wholesale line sells, as the owner groups it: cases of bottles and of cans are one "Case". */
function packagingOf(container: string | null, unitType: string | null): string {
  if (container === 'bottle-case' || container === 'can-case') return 'Case';
  if (container?.startsWith('keg')) return 'Keg';
  if (container === '6-pack') return 'Samples';
  return unitType ?? 'Other';
}

type ProductRevenueRow = { container: string | null; unit_type: string | null; flavor: string | null; revenue: number; units: number };

export default function Reports() {
  const { user } = useAuth();
  const { data: ordersData } = useQuery<{ orders: WholesaleOrder[]; total: number }>({
    queryKey: ["/api/wholesale/orders"],
  });
  const orders = ordersData?.orders;

  const { data: subscriptions } = useQuery<RetailSubscription[]>({
    queryKey: ["/api/retail/subscriptions"],
  });
  const { data: customers } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const totalWholesaleRevenue = orders?.reduce((sum, o) => sum + Number(o.totalAmount), 0) || 0;
  const totalOrders = orders?.length || 0;
  const activeSubscriptions = subscriptions?.filter(s => s.status === 'active').length || 0;

  const monthlyOrders = orders?.filter(o => {
    const orderDate = new Date(o.orderDate);
    const now = new Date();
    // subMonths clamps to the month's last day (May 31 → Apr 30); building the date
    // from day-of-month rolled past short months (reviewer, 2026-10-22).
    const monthAgo = startOfDay(subMonths(now, 1));
    return orderDate >= monthAgo;
  }).length || 0;

  // Revenue shares (owner, 2026-10-16: "replace this with orders by customers. group
  // anyone under 1% into other", then "I want it by $ amount" with a last-3/6/9/12-
  // months-or-all-time selector, all time by default; 2026-10-22: "3 revenue by product
  // pie charts. by packaging type (case/keg), by flavor, by packing type and flavor.
  // group cases of bottles and can together for just case"). One period for all four
  // pies: every wholesale order placed in it that wasn't cancelled.
  const [period, setPeriod] = useState<Period>('all');
  const periodLabel = PERIODS.find(p => p.value === period)?.label ?? 'All time';
  // subMonths clamps to the month's last day (May 31 → Feb 28); building the date
  // from day-of-month rolled past short months and dropped their first days
  // (reviewer, 2026-10-22).
  const since = period === 'all' ? null : startOfDay(subMonths(new Date(), Number(period)));

  const customerSlices = (() => {
    const counted = (orders ?? []).filter(o => o.status !== 'cancelled' && (!since || new Date(o.orderDate) >= since));
    const byCustomer = new Map<string, ShareEntry>();
    for (const o of counted) {
      const entry = byCustomer.get(o.customerId) ?? {
        key: o.customerId,
        name: customers?.find(c => c.id === o.customerId)?.businessName ?? 'Unknown customer',
        value: 0,
        count: 0,
      };
      entry.value += Number(o.totalAmount);
      entry.count += 1;
      byCustomer.set(o.customerId, entry);
    }
    return toShares(Array.from(byCustomer.values()), ['customer', 'customers']);
  })();

  // Line revenue (quantity × unit price) by unit type and flavor, from the server —
  // admin-only, like the rest of the page's money. The three product pies group it
  // three ways.
  const sinceParam = since ? since.toISOString() : 'all';
  const { data: productRevenue } = useQuery<{ rows: ProductRevenueRow[] }>({
    queryKey: ['/api/reports/wholesale-product-revenue', sinceParam],
    queryFn: () => apiRequest('GET', `/api/reports/wholesale-product-revenue?since=${encodeURIComponent(sinceParam)}`),
    enabled: isAdmin,
  });
  const productShares = (group: (r: ProductRevenueRow) => string, otherNoun: [string, string]) => {
    const by = new Map<string, ShareEntry>();
    for (const r of productRevenue?.rows ?? []) {
      const name = group(r);
      const entry = by.get(name) ?? { key: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, value: 0, count: 0 };
      entry.value += Number(r.revenue);
      entry.count += Number(r.units);
      by.set(name, entry);
    }
    return toShares(Array.from(by.values()), otherNoun);
  };
  const flavorOf = (r: ProductRevenueRow) => r.flavor ?? 'Unknown flavor';
  const packagingSlices = productShares(r => packagingOf(r.container, r.unit_type), ['type', 'types']);
  const flavorSlices = productShares(flavorOf, ['flavor', 'flavors']);
  const packagingFlavorSlices = productShares(r => `${packagingOf(r.container, r.unit_type)} · ${flavorOf(r)}`, ['line', 'lines']);

  // Trend granularity (owner, 2026-09-09): weekly by default — with under two
  // months of history, monthly buckets were two lonely bars — monthly a toggle away.
  const [granularity, setGranularity] = useState<'weekly' | 'monthly'>('weekly');

  // Revenue-only trend (owner, 2026-09-09): past buckets show DELIVERED revenue,
  // placed by the date the order was delivered (that's when the revenue is real).
  // The current bucket stacks everything still on the books — open orders roll
  // forward the way they do on the orders board, whenever they were placed.
  const isDelivered = (o: WholesaleOrder) => o.status === 'delivered' || o.status === 'fulfilled';
  const deliveredDate = (o: WholesaleOrder) =>
    new Date(o.deliveryDate ?? o.fulfilledAt ?? o.orderDate);

  const buildTrend = (buckets: Array<{ label: string; start: Date; end: Date }>) => {
    const rows = buckets.map(b => ({ ...b, delivered: 0, ordered: 0 }));
    const current = rows[rows.length - 1];
    orders?.forEach(order => {
      if (order.status === 'cancelled') return;
      if (isDelivered(order)) {
        const d = deliveredDate(order);
        const bucket = rows.find(r => d >= r.start && d < r.end);
        if (bucket) bucket.delivered += Number(order.totalAmount);
      } else {
        current.ordered += Number(order.totalAmount);
      }
    });
    return rows.map(({ label, delivered, ordered }) => ({ label, delivered, ordered }));
  };

  const getLast6Months = () => {
    const now = new Date();
    const buckets = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ label: start.toLocaleDateString('en-US', { month: 'short' }), start, end });
    }
    return buildTrend(buckets);
  };

  const getLast12Weeks = () => {
    const now = new Date();
    const daysSinceMonday = (now.getDay() + 6) % 7; // Mon -> 0 … Sun -> 6
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      buckets.push({ label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), start, end });
    }
    return buildTrend(buckets);
  };

  const trendData = granularity === 'weekly' ? getLast12Weeks() : getLast6Months();

  return (
    <StaffLayout>
      <div className="p-8 space-y-8">
        <div>
        <h1 className="text-2xl font-bold mb-2" data-testid="text-reports-title">
          Reports & Analytics
        </h1>
        <p className="text-muted-foreground" data-testid="text-reports-description">
          Business insights and performance metrics
        </p>
      </div>

      <div className={`grid gap-6 ${isAdmin ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-2'}`}>
        {isAdmin && (
          <Card data-testid="card-wholesale-revenue">
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Wholesale Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-wholesale-revenue">
                ${totalWholesaleRevenue.toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">All-time B2B sales</p>
            </CardContent>
          </Card>
        )}

        <Card data-testid="card-total-orders">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-orders">{totalOrders}</div>
            <p className="text-xs text-muted-foreground">{monthlyOrders} this month</p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-subscriptions">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-subscriptions">
              {activeSubscriptions}
            </div>
            <p className="text-xs text-muted-foreground">B2C recurring revenue</p>
          </CardContent>
        </Card>

        <Card data-testid="card-subscription-breakdown">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subscription Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Active</span>
                <Badge variant="default" data-testid="badge-active">{activeSubscriptions}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Paused</span>
                <Badge variant="secondary" data-testid="badge-paused">
                  {subscriptions?.filter(s => s.status === 'paused').length || 0}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Cancelled</span>
                <Badge variant="secondary" data-testid="badge-cancelled">
                  {subscriptions?.filter(s => s.status === 'cancelled').length || 0}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {isAdmin && (
        <Card data-testid="card-revenue-chart">
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Revenue Trend</CardTitle>
              <CardDescription>
                {granularity === 'weekly'
                  ? 'Delivered revenue, last 12 weeks — this week also stacks orders still to deliver'
                  : 'Delivered revenue, last 6 months — this month also stacks orders still to deliver'}
              </CardDescription>
            </div>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={granularity === 'weekly' ? 'secondary' : 'outline'}
                onClick={() => setGranularity('weekly')}
                data-testid="button-trend-weekly"
              >
                Weekly
              </Button>
              <Button
                size="sm"
                variant={granularity === 'monthly' ? 'secondary' : 'outline'}
                onClick={() => setGranularity('monthly')}
                data-testid="button-trend-monthly"
              >
                Monthly
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                <Legend />
                <Bar stackId="revenue" dataKey="delivered" fill="#10b981" name="Delivered" />
                <Bar stackId="revenue" dataKey="ordered" fill="#60a5fa" name="Ordered (on the books)" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Revenue shares are admin-and-up, like the cards and trend above
          (reviewer, 2026-10-22). */}
      {isAdmin && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold" data-testid="text-revenue-breakdown">Revenue breakdown</h2>
              <p className="text-sm text-muted-foreground">
                Wholesale orders placed {period === 'all' ? 'all time' : `in the ${periodLabel.toLowerCase()}`} that weren't cancelled; anything under 1% pools into Other.
              </p>
            </div>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger className="w-40 shrink-0" data-testid="select-revenue-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Card data-testid="card-orders-by-customer">
            <CardHeader>
              <CardTitle>Orders by Customer</CardTitle>
              <CardDescription>Share of wholesale order value by customer, {periodLabel.toLowerCase()}</CardDescription>
            </CardHeader>
            <CardContent>
              <SharePie slices={customerSlices} countNoun={['order', 'orders']} layout="side" testId="list-orders-by-customer" empty="No wholesale orders in this period." />
            </CardContent>
          </Card>

          {/* Three ways to cut the same line revenue (owner, 2026-10-22). */}
          <div className="grid gap-6 lg:grid-cols-3">
            <Card data-testid="card-revenue-by-packaging">
              <CardHeader>
                <CardTitle>Revenue by Packaging</CardTitle>
                <CardDescription>Case or keg, {periodLabel.toLowerCase()} — cases of bottles and of cans count as Case</CardDescription>
              </CardHeader>
              <CardContent>
                <SharePie slices={packagingSlices} countNoun={['unit', 'units']} layout="stack" testId="list-revenue-by-packaging" empty="No wholesale lines in this period." />
              </CardContent>
            </Card>
            <Card data-testid="card-revenue-by-flavor">
              <CardHeader>
                <CardTitle>Revenue by Flavor</CardTitle>
                <CardDescription>Every package of a flavor together, {periodLabel.toLowerCase()}</CardDescription>
              </CardHeader>
              <CardContent>
                <SharePie slices={flavorSlices} countNoun={['unit', 'units']} layout="stack" testId="list-revenue-by-flavor" empty="No wholesale lines in this period." />
              </CardContent>
            </Card>
            <Card data-testid="card-revenue-by-packaging-flavor">
              <CardHeader>
                <CardTitle>Revenue by Packaging and Flavor</CardTitle>
                <CardDescription>Each package of each flavor, {periodLabel.toLowerCase()}</CardDescription>
              </CardHeader>
              <CardContent>
                <SharePie slices={packagingFlavorSlices} countNoun={['unit', 'units']} layout="stack" testId="list-revenue-by-packaging-flavor" empty="No wholesale lines in this period." />
              </CardContent>
            </Card>
          </div>
        </>
      )}
      </div>
    </StaffLayout>
  );
}
