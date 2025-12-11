import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { StaffLayout } from "@/components/staff/staff-layout";
import { 
  FileText,
  TrendingUp, 
  TrendingDown,
  DollarSign,
  Calendar as CalendarIcon,
  ChevronRight
} from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import type { AccountingCategory } from "@shared/schema";

interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  incomeByCategory: { categoryId: string; categoryName: string; total: number }[];
  expensesByCategory: { categoryId: string; categoryName: string; total: number }[];
  unallocatedCount: number;
  unallocatedAmount: number;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { 
    style: 'currency', 
    currency: 'USD' 
  }).format(amount);
}

export default function AccountingIncomeStatement() {
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(new Date()));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));

  const { data: summary, isLoading } = useQuery<FinancialSummary>({
    queryKey: ['/api/accounting/summary', { 
      startDate: dateFrom.toISOString(),
      endDate: dateTo.toISOString()
    }],
  });

  const { data: categories = [] } = useQuery<AccountingCategory[]>({
    queryKey: ['/api/accounting/categories'],
  });

  const setPresetPeriod = (months: number) => {
    const now = new Date();
    if (months === 0) {
      setDateFrom(startOfMonth(now));
      setDateTo(endOfMonth(now));
    } else {
      const start = startOfMonth(subMonths(now, months));
      const end = endOfMonth(now);
      setDateFrom(start);
      setDateTo(end);
    }
  };

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="heading-income-statement">
              Income Statement
            </h1>
            <p className="text-muted-foreground">
              {format(dateFrom, "MMM d, yyyy")} - {format(dateTo, "MMM d, yyyy")}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => setPresetPeriod(0)} data-testid="button-this-month">
              This Month
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPresetPeriod(2)} data-testid="button-last-3-months">
              Last 3 Months
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPresetPeriod(5)} data-testid="button-last-6-months">
              Last 6 Months
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPresetPeriod(11)} data-testid="button-last-12-months">
              Last 12 Months
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarIcon className="h-5 w-5" />
              Date Range
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <div className="space-y-2">
                <Label>From</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-[200px] justify-start text-left font-normal")}
                      data-testid="button-date-from"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateFrom, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>To</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn("w-[200px] justify-start text-left font-normal")}
                      data-testid="button-date-to"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(dateTo, "MMM d, yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} initialFocus />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="pb-2">
                  <Skeleton className="h-4 w-24" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-8 w-32" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                <TrendingUp className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600" data-testid="text-total-revenue">
                  {formatCurrency(summary?.totalIncome || 0)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
                <TrendingDown className="h-4 w-4 text-red-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600" data-testid="text-total-expenses">
                  {formatCurrency(summary?.totalExpenses || 0)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Net Income</CardTitle>
                <DollarSign className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <div className={cn(
                  "text-2xl font-bold",
                  (summary?.netIncome || 0) >= 0 ? "text-green-600" : "text-red-600"
                )} data-testid="text-net-income">
                  {formatCurrency(summary?.netIncome || 0)}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Revenue
              </CardTitle>
              <CardDescription>Income by category</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : summary?.incomeByCategory && summary.incomeByCategory.length > 0 ? (
                <div className="space-y-2">
                  {summary.incomeByCategory.map((item) => (
                    <Link 
                      key={item.categoryId}
                      href={`/admin/accounting/transactions?categoryId=${item.categoryId}&startDate=${dateFrom.toISOString()}&endDate=${dateTo.toISOString()}`}
                    >
                      <div 
                        className="flex items-center justify-between p-3 rounded-md hover-elevate cursor-pointer"
                        data-testid={`row-income-${item.categoryId}`}
                      >
                        <span className="text-sm font-medium">{item.categoryName}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-green-600">
                            {formatCurrency(item.total)}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))}
                  <div className="flex items-center justify-between p-3 border-t mt-2 pt-4">
                    <span className="font-semibold">Total Revenue</span>
                    <span className="font-bold text-green-600">
                      {formatCurrency(summary.totalIncome)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No income recorded for this period</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                Expenses
              </CardTitle>
              <CardDescription>Expenses by category</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : summary?.expensesByCategory && summary.expensesByCategory.length > 0 ? (
                <div className="space-y-2">
                  {summary.expensesByCategory.map((item) => (
                    <Link 
                      key={item.categoryId}
                      href={`/admin/accounting/transactions?categoryId=${item.categoryId}&startDate=${dateFrom.toISOString()}&endDate=${dateTo.toISOString()}`}
                    >
                      <div 
                        className="flex items-center justify-between p-3 rounded-md hover-elevate cursor-pointer"
                        data-testid={`row-expense-${item.categoryId}`}
                      >
                        <span className="text-sm font-medium">{item.categoryName}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-red-600">
                            {formatCurrency(Math.abs(item.total))}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </div>
                    </Link>
                  ))}
                  <div className="flex items-center justify-between p-3 border-t mt-2 pt-4">
                    <span className="font-semibold">Total Expenses</span>
                    <span className="font-bold text-red-600">
                      {formatCurrency(summary.totalExpenses)}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No expenses recorded for this period</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span>Total Revenue</span>
                <span className="font-medium text-green-600">
                  {formatCurrency(summary?.totalIncome || 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span>Total Expenses</span>
                <span className="font-medium text-red-600">
                  ({formatCurrency(summary?.totalExpenses || 0)})
                </span>
              </div>
              <div className="border-t pt-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">Net Income</span>
                  <span className={cn(
                    "text-xl font-bold",
                    (summary?.netIncome || 0) >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {formatCurrency(summary?.netIncome || 0)}
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
