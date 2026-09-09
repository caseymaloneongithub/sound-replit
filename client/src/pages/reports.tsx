import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WholesaleOrder, RetailSubscription } from "@shared/schema";
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

  const orderStatusData = [
    { name: 'Pending', value: orders?.filter(o => o.status === 'pending').length || 0, color: '#94a3b8' },
    { name: 'Processing', value: orders?.filter(o => o.status === 'processing').length || 0, color: '#60a5fa' },
    { name: 'Shipped', value: orders?.filter(o => o.status === 'shipped').length || 0, color: '#34d399' },
    { name: 'Delivered', value: orders?.filter(o => o.status === 'delivered').length || 0, color: '#10b981' },
  ];

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

      <Card data-testid="card-order-status-chart">
        <CardHeader>
          <CardTitle>Order Status Distribution</CardTitle>
          <CardDescription>Current wholesale order pipeline</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={orderStatusData.filter(d => d.value > 0)}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {orderStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
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
