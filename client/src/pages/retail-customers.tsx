import { useQuery } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Loader2 } from "lucide-react";

export default function RetailCustomers() {
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

        <Card>
          <CardContent className="py-12 text-center">
            <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">Retail customer management coming soon</p>
            <p className="text-sm text-muted-foreground">
              This feature will allow you to view and manage all retail customer accounts
            </p>
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
