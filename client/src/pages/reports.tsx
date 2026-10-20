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
    const monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    return orderDate >= monthAgo;
  }).length || 0;

  // Orders by customer (owner, 2026-10-16: "replace this with orders by customers.
  // group anyone under 1% into other", then "I want it by $ amount" with a
  // last-3/6/9/12-months-or-all-time selector, all time by default). The value of
  // every wholesale order placed in the period that wasn't cancelled, summed against
  // its customer; customers under 1% of the period's total pool into one Other slice.
  const OTHER_BELOW_SHARE = 0.01;
  const CUSTOMER_PERIODS = [
    { value: '3', label: 'Last 3 months' },
    { value: '6', label: 'Last 6 months' },
    { value: '9', label: 'Last 9 months' },
    { value: '12', label: 'Last 12 months' },
    { value: 'all', label: 'All time' },
  ] as const;
  type CustomerPeriod = (typeof CUSTOMER_PERIODS)[number]['value'];
  const [customerPeriod, setCustomerPeriod] = useState<CustomerPeriod>('all');
  const customerPeriodLabel = CUSTOMER_PERIODS.find(p => p.value === customerPeriod)?.label ?? 'All time';
  const money0 = (v: number) => `$${Math.round(v).toLocaleString()}`;
  const CUSTOMER_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#ec4899', '#06b6d4', '#a855f7', '#eab308', '#22c55e', '#0ea5e9', '#d946ef',
  ];
  type CustomerSlice = { key: string; name: string; value: number; orders: number; share: string; color: string };
  const customerSlices: CustomerSlice[] = (() => {
    const now = new Date();
    const since = customerPeriod === 'all'
      ? null
      : new Date(now.getFullYear(), now.getMonth() - Number(customerPeriod), now.getDate());
    const counted = (orders ?? []).filter(o => o.status !== 'cancelled' && (!since || new Date(o.orderDate) >= since));
    const total = counted.reduce((s, o) => s + Number(o.totalAmount), 0);
    if (total <= 0) return [];
    const byCustomer = new Map<string, { value: number; orders: number }>();
    for (const o of counted) {
      const entry = byCustomer.get(o.customerId) ?? { value: 0, orders: 0 };
      entry.value += Number(o.totalAmount);
      entry.orders += 1;
      byCustomer.set(o.customerId, entry);
    }
    const named = Array.from(byCustomer.entries())
      .map(([id, v]) => ({ key: id, name: customers?.find(c => c.id === id)?.businessName ?? 'Unknown customer', ...v }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
    const share = (value: number) => (100 * value / total).toFixed(1);
    const slices: CustomerSlice[] = named
      .filter(c => c.value / total >= OTHER_BELOW_SHARE)
      .map((c, i) => ({ ...c, share: share(c.value), color: CUSTOMER_COLORS[i % CUSTOMER_COLORS.length] }));
    const small = named.filter(c => c.value / total < OTHER_BELOW_SHARE);
    if (small.length > 0) {
      const value = small.reduce((s, c) => s + c.value, 0);
      slices.push({
        key: 'other',
        name: `Other (${small.length} ${small.length === 1 ? 'customer' : 'customers'})`,
        value,
        orders: small.reduce((s, c) => s + c.orders, 0),
        share: share(value),
        color: '#94a3b8',
      });
    }
    return slices;
  })();

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

      <Card data-testid="card-orders-by-customer">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Orders by Customer</CardTitle>
            <CardDescription>
              Share of wholesale order value, {customerPeriodLabel.toLowerCase()} — customers under 1% are grouped as Other
            </CardDescription>
          </div>
          <Select value={customerPeriod} onValueChange={(v) => setCustomerPeriod(v as CustomerPeriod)}>
            <SelectTrigger className="w-40 shrink-0" data-testid="select-customer-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_PERIODS.map((p) => (
                <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {customerSlices.length === 0 ? (
            <p className="text-muted-foreground text-sm py-12 text-center">No wholesale orders in this period.</p>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 items-center">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={customerSlices}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    // Only slices big enough to carry a label get one; the list names the rest.
                    label={(p: any) => (p.percent >= 0.05 ? `${p.name} ${Math.round(p.percent * 100)}%` : null)}
                    outerRadius={100}
                    dataKey="value"
                    nameKey="name"
                  >
                    {customerSlices.map((s) => (
                      <Cell key={s.key} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(v: number, name: string, item: any) => {
                      const n = Number(item?.payload?.orders ?? 0);
                      return [`${money0(v)} · ${n} ${n === 1 ? 'order' : 'orders'}`, name];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <ul className="space-y-0.5 text-sm max-h-72 overflow-y-auto pr-1" data-testid="list-orders-by-customer">
                {customerSlices.map((s) => (
                  <li key={s.key} className="flex items-center justify-between gap-3 py-1" data-testid={`row-customer-share-${s.key}`}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="truncate">{s.name}</span>
                    </span>
                    <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                      {money0(s.value)} · {s.orders} {s.orders === 1 ? 'order' : 'orders'} · {s.share}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-order-status">
        <CardHeader>
          <CardTitle>Order Status Breakdown</CardTitle>
          <CardDescription>Current wholesale order pipeline</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
            <span className="font-medium">Pending</span>
            <Badge variant="secondary" data-testid="badge-status-pending">
              {orders?.filter(o => o.status === 'pending').length || 0}
            </Badge>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
            <span className="font-medium">Processing</span>
            <Badge variant="default" data-testid="badge-status-processing">
              {orders?.filter(o => o.status === 'processing').length || 0}
            </Badge>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
            <span className="font-medium">Shipped</span>
            <Badge variant="default" data-testid="badge-status-shipped">
              {orders?.filter(o => o.status === 'shipped').length || 0}
            </Badge>
          </div>
          <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
            <span className="font-medium">Delivered</span>
            <Badge variant="default" className="bg-green-500" data-testid="badge-status-delivered">
              {orders?.filter(o => o.status === 'delivered').length || 0}
            </Badge>
          </div>
        </CardContent>
      </Card>
      </div>
    </StaffLayout>
  );
}
