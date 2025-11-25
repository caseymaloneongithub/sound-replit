import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Subscription, Product } from "@shared/schema";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon, Printer, Package } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { CASE_SIZE } from "@shared/pricing";

export default function RetailPickupReport() {
  const { user } = useAuth();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const { data: subscriptions = [], isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/retail/pickup-report", format(selectedDate, "yyyy-MM-dd")],
    queryFn: async () => {
      const response = await fetch(`/api/retail/pickup-report?date=${format(selectedDate, "yyyy-MM-dd")}`);
      if (!response.ok) {
        throw new Error('Failed to fetch pickup report');
      }
      return response.json();
    },
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const handlePrint = () => {
    window.print();
  };

  const totalPickups = subscriptions.length;
  const uniqueCustomers = new Set(subscriptions.map(s => s.customerEmail)).size;

  const getFrequencyLabel = (frequency: string | null) => {
    switch (frequency) {
      case 'weekly': return 'Weekly';
      case 'bi-weekly': return 'Bi-weekly';
      case 'every-4-weeks': return 'Every 4 weeks';
      case 'every-6-weeks': return 'Every 6 weeks';
      case 'every-8-weeks': return 'Every 8 weeks';
      default: return 'N/A';
    }
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8 print:hidden">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              Daily Pickup Report
            </h1>
            <p className="text-muted-foreground">
              View and print retail pickup schedules
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="justify-start text-left font-normal"
                  data-testid="button-select-date"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, "PPP")}
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
              Daily Pickup Report
            </h1>
            <p className="text-lg text-muted-foreground">
              {format(selectedDate, "PPPP")}
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 print:grid-cols-2">
            <Card>
              <CardHeader className="space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Pickups</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-total-pickups">{totalPickups}</div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Unique Customers</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold" data-testid="text-unique-customers">
                  {uniqueCustomers}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>
                Scheduled Pickups
              </CardTitle>
              <CardDescription>
                Subscriptions scheduled for pickup on {format(selectedDate, "MMMM d, yyyy")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {subscriptionsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-24 bg-muted rounded-lg animate-pulse" />
                  ))}
                </div>
              ) : subscriptions.length > 0 ? (
                <div className="space-y-4">
                  {subscriptions.map((subscription) => {
                    const product = products.find(p => p.id === subscription.productId);
                    
                    return (
                      <div 
                        key={subscription.id} 
                        className="border rounded-lg p-4 space-y-3 print:break-inside-avoid"
                        data-testid={`pickup-${subscription.id}`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-semibold text-lg">
                                {subscription.customerName}
                              </h3>
                              <Badge variant="secondary" className="capitalize">
                                {subscription.status}
                              </Badge>
                            </div>
                            <div className="text-sm text-muted-foreground space-y-1">
                              <p>Email: {subscription.customerEmail}</p>
                              {subscription.customerPhone && (
                                <p>Phone: {subscription.customerPhone}</p>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <Package className="w-4 h-4" />
                                <span className="font-medium">
                                  {product?.name || 'Unknown Product'}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {getFrequencyLabel(subscription.subscriptionFrequency)}
                                </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm text-muted-foreground">Next Pickup</p>
                            <p className="text-lg font-semibold">
                              {subscription.nextDeliveryDate 
                                ? format(new Date(subscription.nextDeliveryDate), "h:mm a")
                                : 'Not scheduled'}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-12">
                  <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    No pickups scheduled for this date
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
