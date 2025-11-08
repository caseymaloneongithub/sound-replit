import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Calendar, Loader2 } from "lucide-react";

export default function RetailPickupReport() {
  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Pickup Report
          </h1>
          <p className="text-muted-foreground">
            Generate daily pickup reports for retail customers
          </p>
        </div>

        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-2">Pickup report generation coming soon</p>
            <p className="text-sm text-muted-foreground">
              This feature will allow you to generate and view daily pickup reports for retail orders
            </p>
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
