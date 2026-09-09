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

  const getLast6Months = () => {
    const months: Array<{ label: string; year: number; monthIdx: number; revenue: number; orders: number }> = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        label: date.toLocaleDateString('en-US', { month: 'short' }),
        year: date.getFullYear(),
        monthIdx: date.getMonth(),
        revenue: 0,
        orders: 0,
      });
    }
    orders?.forEach(order => {
      const orderDate = new Date(order.orderDate);
      const bucket = months.find(m => orderDate.getMonth() === m.monthIdx && orderDate.getFullYear() === m.year);
      if (bucket) {
        bucket.revenue += Number(order.totalAmount);
        bucket.orders += 1;
      }
    });
    return months.map(({ label, revenue, orders: n }) => ({ label, revenue, orders: n }));
  };

  const getLast12Weeks = () => {
    const now = new Date();
    const daysSinceMonday = (now.getDay() + 6) % 7; // Mon -> 0 … Sun -> 6
    const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    const weeks: Array<{ label: string; start: Date; end: Date; revenue: number; orders: number }> = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(end.getDate() + 7);
      weeks.push({
        label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        start,
        end,
        revenue: 0,
        orders: 0,
      });
    }
    orders?.forEach(order => {
      const orderDate = new Date(order.orderDate);
      const bucket = weeks.find(w => orderDate >= w.start && orderDate < w.end);
      if (bucket) {
        bucket.revenue += Number(order.totalAmount);
        bucket.orders += 1;
      }
    });
    return weeks.map(({ label, revenue, orders: n }) => ({ label, revenue, orders: n }));
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
              <CardTitle>Revenue & Orders Trend</CardTitle>
              <CardDescription>
                {granularity === 'weekly' ? 'Last 12 weeks (weeks start Monday)' : 'Last 6 months'}
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
                <YAxis yAxisId="left" orientation="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="revenue" fill="#10b981" name="Revenue ($)" />
                <Bar yAxisId="right" dataKey="orders" fill="#60a5fa" name="Orders" />
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
