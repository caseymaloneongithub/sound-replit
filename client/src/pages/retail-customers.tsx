import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Users, Loader2, Mail, Phone, Package, Search } from "lucide-react";

interface RetailCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  subscriptionCount: number;
  activeSubscriptionCount: number;
}

export default function RetailCustomers() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: customers, isLoading } = useQuery<RetailCustomer[]>({
    queryKey: ["/api/retail/customers", searchQuery],
    queryFn: async () => {
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : '';
      const response = await fetch(`/api/retail/customers${params}`);
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Retail Customers
          </h1>
          <p className="text-muted-foreground">
            View and manage retail customer accounts
          </p>
        </div>

        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              data-testid="input-search-customers"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Customer Directory</CardTitle>
            <CardDescription>
              {customers && customers.length > 0
                ? `Showing ${customers.length} customer${customers.length === 1 ? '' : 's'}`
                : 'No customers found'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : customers && customers.length > 0 ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {customers.map((customer) => (
                  <Card 
                    key={customer.id} 
                    className="hover-elevate" 
                    data-testid={`customer-card-${customer.id}`}
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
                        {customer.firstName} {customer.lastName}
                      </CardTitle>
                      <div className="flex gap-2 flex-wrap">
                        <Badge 
                          variant="secondary" 
                          className="text-xs"
                          data-testid={`badge-subscriptions-${customer.id}`}
                        >
                          <Package className="w-3 h-3 mr-1" />
                          {customer.subscriptionCount} subscription{customer.subscriptionCount === 1 ? '' : 's'}
                        </Badge>
                        {customer.activeSubscriptionCount > 0 && (
                          <Badge 
                            variant="default" 
                            className="text-xs"
                            data-testid={`badge-active-${customer.id}`}
                          >
                            {customer.activeSubscriptionCount} active
                          </Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Mail className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span 
                          className="text-muted-foreground truncate"
                          title={customer.email}
                          data-testid={`email-${customer.id}`}
                        >
                          {customer.email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Phone className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span 
                          className="text-muted-foreground"
                          data-testid={`phone-${customer.id}`}
                        >
                          {customer.phoneNumber}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground mb-1">
                  {searchQuery ? 'No customers match your search' : 'No retail customers yet'}
                </p>
                {searchQuery && (
                  <p className="text-sm text-muted-foreground">
                    Try adjusting your search terms
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
