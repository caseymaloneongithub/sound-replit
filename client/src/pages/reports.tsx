import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Package, Users, DollarSign, ShoppingBag } from "lucide-react";
import type { WholesaleOrder, Subscription, Product } from "@shared/schema";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function Reports() {
  const { data: orders } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/orders"],
  });

  const { data: subscriptions } = useQuery<Subscription[]>({
    queryKey: ["/api/subscriptions"],
  });

  const { data: products } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const totalWholesaleRevenue = orders?.reduce((sum, o) => sum + Number(o.totalAmount), 0) || 0;
  const totalOrders = orders?.length || 0;
  const activeSubscriptions = subscriptions?.filter(s => s.status === 'active').length || 0;
  const totalProducts = products?.length || 0;
  const lowStockItems = products?.filter(p => p.stockQuantity <= p.lowStockThreshold).length || 0;

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

  const inventoryData = [
    { name: 'In Stock', count: products?.filter(p => p.stockQuantity > p.lowStockThreshold).length || 0 },
    { name: 'Low Stock', count: lowStockItems },
    { name: 'Out of Stock', count: products?.filter(p => p.stockQuantity === 0).length || 0 },
  ];

  const getLast6Months = () => {
    const months = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        month: date.toLocaleDateString('en-US', { month: 'short' }),
        revenue: 0,
        orders: 0,
      });
    }
    
    orders?.forEach(order => {
      const orderDate = new Date(order.orderDate);
      const monthIndex = months.findIndex(m => {
        const date = new Date();
        date.setMonth(date.getMonth() - (5 - months.indexOf(m)));
        return orderDate.getMonth() === date.getMonth() && 
               orderDate.getFullYear() === date.getFullYear();
      });
      
      if (monthIndex >= 0) {
        months[monthIndex].revenue += Number(order.totalAmount);
        months[monthIndex].orders += 1;
      }
    });
    
    return months;
  };

  const monthlyData = getLast6Months();

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2" data-testid="text-reports-title">
          Reports & Analytics
        </h1>
        <p className="text-muted-foreground" data-testid="text-reports-description">
          Business insights and performance metrics
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card data-testid="card-wholesale-revenue">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Wholesale Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-wholesale-revenue">
              ${totalWholesaleRevenue.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">All-time B2B sales</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-orders">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-orders">{totalOrders}</div>
            <p className="text-xs text-muted-foreground">{monthlyOrders} this month</p>
          </CardContent>
        </Card>

        <Card data-testid="card-active-subscriptions">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Subscriptions</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-active-subscriptions">
              {activeSubscriptions}
            </div>
            <p className="text-xs text-muted-foreground">B2C recurring revenue</p>
          </CardContent>
        </Card>

        <Card data-testid="card-total-products">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Products</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-products">{totalProducts}</div>
            <p className="text-xs text-muted-foreground">Active SKUs</p>
          </CardContent>
        </Card>

        <Card data-testid="card-low-stock-alerts">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low Stock Alerts</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-low-stock-count">
              {lowStockItems}
            </div>
            <p className="text-xs text-muted-foreground">Items need restocking</p>
          </CardContent>
        </Card>

        <Card data-testid="card-subscription-breakdown">
          <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Subscription Status</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
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

      <Card data-testid="card-revenue-chart">
        <CardHeader>
          <CardTitle>Revenue & Orders Trend</CardTitle>
          <CardDescription>Last 6 months performance</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
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

      <div className="grid gap-6 md:grid-cols-2">
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

        <Card data-testid="card-inventory-chart">
          <CardHeader>
            <CardTitle>Inventory Status</CardTitle>
            <CardDescription>Stock levels across all products</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={inventoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" />
                <Tooltip />
                <Bar dataKey="count" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
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

        <Card data-testid="card-inventory-summary">
          <CardHeader>
            <CardTitle>Inventory Summary</CardTitle>
            <CardDescription>Stock levels across all products</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="font-medium">In Stock</span>
              <Badge variant="default" data-testid="badge-in-stock">
                {products?.filter(p => p.stockQuantity > p.lowStockThreshold).length || 0}
              </Badge>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="font-medium">Low Stock</span>
              <Badge variant="secondary" data-testid="badge-low-stock">
                {lowStockItems}
              </Badge>
            </div>
            <div className="flex justify-between items-center p-3 rounded-lg bg-muted/50">
              <span className="font-medium">Out of Stock</span>
              <Badge variant="destructive" data-testid="badge-out-of-stock">
                {products?.filter(p => p.stockQuantity === 0).length || 0}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
