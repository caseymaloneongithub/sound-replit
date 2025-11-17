import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { WholesaleOrder, WholesaleCustomer, WholesaleOrderItem, Product } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarIcon, Printer } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { format, startOfWeek, endOfWeek, addDays } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

type ReportView = "daily" | "weekly";

export default function WholesaleDeliveryReport() {
  const { user } = useAuth();
  const [reportView, setReportView] = useState<ReportView>("daily");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  // Calculate date range based on view
  // For weekly: use half-open range [Monday 00:00, next Monday 00:00) to avoid timezone issues
  const startDate = reportView === "weekly" 
    ? startOfWeek(selectedDate, { weekStartsOn: 1 }) // Monday at 00:00:00 local
    : selectedDate;
  const endDate = reportView === "weekly"
    ? addDays(startOfWeek(selectedDate, { weekStartsOn: 1 }), 7) // Next Monday at 00:00:00 local (exclusive upper bound)
    : selectedDate;

  const { data: orders = [], isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale/delivery-report", reportView, startDate.toISOString(), endDate.toISOString()],
    queryFn: async () => {
      const url = reportView === "daily"
        ? `/api/wholesale/delivery-report?date=${selectedDate.toISOString()}`
        : `/api/wholesale/delivery-report?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch delivery report');
      }
      return response.json();
    },
  });
  
  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: allOrderItems = [] } = useQuery<WholesaleOrderItem[]>({
    queryKey: ["/api/wholesale/all-order-items"],
    queryFn: async () => {
      const items: WholesaleOrderItem[] = [];
      for (const order of orders) {
        const response = await fetch(`/api/wholesale/orders/${order.id}/items`);
        if (response.ok) {
          const orderItems = await response.json();
          items.push(...orderItems);
        }
      }
      return items;
    },
    enabled: orders.length > 0,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'secondary';
      case 'delivered': return 'default';
      default: return 'secondary';
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const totalAmount = orders.reduce((sum, order) => sum + Number(order.totalAmount), 0);
  const totalOrders = orders.length;

  const reportTitle = reportView === "daily" ? "Daily Delivery Report" : "Weekly Delivery Report";
  // For display: show actual week end (Sunday) not the exclusive bound (next Monday)
  const displayEndDate = reportView === "weekly" ? addDays(endDate, -1) : endDate;
  const dateRangeText = reportView === "daily" 
    ? format(selectedDate, "PPP")
    : `${format(startDate, "MMM d")} - ${format(displayEndDate, "MMM d, yyyy")}`;
  const detailDateText = reportView === "daily"
    ? format(selectedDate, "MMMM d, yyyy")
    : `week of ${format(startDate, "MMMM d, yyyy")} (${format(startDate, "MMM d")} - ${format(displayEndDate, "MMM d")})`;

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              {reportTitle}
            </h1>
            <p className="text-muted-foreground">
              View and print wholesale delivery schedules
            </p>
          </div>
          <div className="flex items-center gap-4">
                <Tabs value={reportView} onValueChange={(value) => setReportView(value as ReportView)}>
                  <TabsList>
                    <TabsTrigger value="daily" data-testid="tab-daily">Daily</TabsTrigger>
                    <TabsTrigger value="weekly" data-testid="tab-weekly">Weekly</TabsTrigger>
                  </TabsList>
                </Tabs>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="justify-start text-left font-normal"
                      data-testid="button-select-date"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRangeText}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => date && setSelectedDate(date)}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant="outline"
                  onClick={handlePrint}
                  data-testid="button-print"
                >
                  <Printer className="mr-2 h-4 w-4" />
                  Print Report
                </Button>
          </div>
        </div>

        <div className="space-y-6">
          <div className="hidden print:block mb-6">
                <h1 className="text-3xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
                  {reportTitle}
                </h1>
                <p className="text-lg text-muted-foreground">
                  {reportView === "daily" ? format(selectedDate, "PPPP") : dateRangeText}
                </p>
              </div>

              <div className={`grid gap-4 ${isAdmin ? 'md:grid-cols-3 print:grid-cols-3' : 'md:grid-cols-2 print:grid-cols-2'}`}>
                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Orders</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-total-orders">{totalOrders}</div>
                  </CardContent>
                </Card>
                
                {isAdmin && (
                  <Card>
                    <CardHeader className="space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Total Value</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold" data-testid="text-total-value">
                        ${totalAmount.toFixed(2)}
                      </div>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Unique Customers</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-2xl font-bold" data-testid="text-unique-customers">
                      {new Set(orders.map(o => o.customerId)).size}
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>
                    Scheduled Deliveries
                  </CardTitle>
                  <CardDescription>
                    {reportView === "daily" 
                      ? `Orders scheduled for delivery on ${detailDateText}`
                      : `Orders scheduled for delivery during the ${detailDateText}`
                    }
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {ordersLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : orders.length > 0 ? (
                    <div className="space-y-4">
                      {orders.map((order) => {
                        const customer = customers.find(c => c.id === order.customerId);
                        const orderItems = allOrderItems.filter(item => item.orderId === order.id);
                        
                        return (
                          <div 
                            key={order.id} 
                            className="border rounded-lg p-4 space-y-3 print:break-inside-avoid"
                            data-testid={`delivery-${order.id}`}
                          >
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                              <div className="flex-1">
                                <div className="flex items-center gap-3 mb-2">
                                  <h3 className="font-semibold text-lg">
                                    {customer?.businessName || 'Unknown Customer'}
                                  </h3>
                                  <Badge variant={getStatusColor(order.status)} className="capitalize">
                                    {order.status}
                                  </Badge>
                                </div>
                                <div className="text-sm text-muted-foreground space-y-1">
                                  <p>Contact: {customer?.contactName}</p>
                                  <p>Phone: {customer?.phone}</p>
                                  <p>Address: {customer?.address}</p>
                                  {order.notes && (
                                    <p className="italic mt-2">Notes: {order.notes}</p>
                                  )}
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="text-sm text-muted-foreground">Order Total</p>
                                <p className="text-2xl font-bold">
                                  ${Number(order.totalAmount).toFixed(2)}
                                </p>
                              </div>
                            </div>

                            {orderItems.length > 0 && (
                              <div className="mt-3 pt-3 border-t">
                                <p className="text-sm font-medium mb-2">Items:</p>
                                <div className="space-y-2">
                                  {orderItems.map((item) => {
                                    const product = products.find(p => p.id === item.productId);
                                    return (
                                      <div 
                                        key={item.id}
                                        className="flex items-center justify-between text-sm"
                                      >
                                        <span>
                                          {product?.name || 'Unknown Product'} × {item.quantity}
                                        </span>
                                        <span className="font-medium">
                                          ${(Number(item.unitPrice) * item.quantity).toFixed(2)}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">
                        No deliveries scheduled for this date
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
        </div>
      </div>
    </StaffLayout>
  );
}
