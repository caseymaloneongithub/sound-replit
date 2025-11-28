import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffLayout } from "@/components/staff/staff-layout";
import { 
  Receipt, 
  Tags, 
  Landmark, 
  TrendingUp, 
  TrendingDown,
  AlertCircle,
  ArrowRight,
  DollarSign,
  PieChart
} from "lucide-react";
import type { AccountingCategory, AccountingTransaction, PlaidAccount } from "@shared/schema";

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

function SummaryCard({ 
  title, 
  value, 
  description, 
  icon: Icon, 
  trend,
  className = "" 
}: { 
  title: string; 
  value: string; 
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  trend?: 'positive' | 'negative' | 'neutral';
  className?: string;
}) {
  const trendColor = trend === 'positive' ? 'text-green-600' : trend === 'negative' ? 'text-red-600' : 'text-muted-foreground';
  
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${trendColor}`}>{value}</div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AccountingDashboard() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  
  const { data: summary, isLoading: summaryLoading } = useQuery<FinancialSummary>({
    queryKey: ['/api/accounting/summary', currentMonth],
  });

  const { data: categories = [], isLoading: categoriesLoading } = useQuery<AccountingCategory[]>({
    queryKey: ['/api/accounting/categories'],
  });

  const { data: accounts = [], isLoading: accountsLoading } = useQuery<PlaidAccount[]>({
    queryKey: ['/api/accounting/plaid/accounts'],
  });

  const { data: recentTransactions = [], isLoading: transactionsLoading } = useQuery<AccountingTransaction[]>({
    queryKey: ['/api/accounting/transactions', { limit: 10 }],
  });

  const isLoading = summaryLoading || categoriesLoading || accountsLoading || transactionsLoading;

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="heading-accounting-dashboard">
              Accounting Dashboard
            </h1>
            <p className="text-muted-foreground">
              Financial overview for {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" asChild data-testid="link-transactions">
              <Link href="/admin/accounting/transactions">
                <Receipt className="w-4 h-4 mr-2" />
                View Transactions
              </Link>
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              title="Total Income"
              value={formatCurrency(summary?.totalIncome || 0)}
              icon={TrendingUp}
              trend="positive"
            />
            <SummaryCard
              title="Total Expenses"
              value={formatCurrency(summary?.totalExpenses || 0)}
              icon={TrendingDown}
              trend="negative"
            />
            <SummaryCard
              title="Net Income"
              value={formatCurrency(summary?.netIncome || 0)}
              icon={DollarSign}
              trend={(summary?.netIncome || 0) >= 0 ? 'positive' : 'negative'}
            />
            <SummaryCard
              title="Unallocated"
              value={String(summary?.unallocatedCount || 0)}
              description={`${formatCurrency(summary?.unallocatedAmount || 0)} needs review`}
              icon={AlertCircle}
              trend="neutral"
            />
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Income by Category
              </CardTitle>
              <CardDescription>Revenue breakdown for the current month</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : summary?.incomeByCategory && summary.incomeByCategory.length > 0 ? (
                <div className="space-y-3">
                  {summary.incomeByCategory.map((item) => (
                    <div key={item.categoryId} className="flex items-center justify-between">
                      <span className="text-sm">{item.categoryName}</span>
                      <span className="font-medium text-green-600">
                        {formatCurrency(item.total)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No income recorded this month</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                Expenses by Category
              </CardTitle>
              <CardDescription>Spending breakdown for the current month</CardDescription>
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <div className="space-y-2">
                  {[...Array(3)].map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : summary?.expensesByCategory && summary.expensesByCategory.length > 0 ? (
                <div className="space-y-3">
                  {summary.expensesByCategory.map((item) => (
                    <div key={item.categoryId} className="flex items-center justify-between">
                      <span className="text-sm">{item.categoryName}</span>
                      <span className="font-medium text-red-600">
                        {formatCurrency(Math.abs(item.total))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No expenses recorded this month</p>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Tags className="h-5 w-5" />
                Categories
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">{categories.length}</div>
              <p className="text-muted-foreground text-sm mb-4">
                Active accounting categories
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/accounting/categories">
                  Manage Categories
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Landmark className="h-5 w-5" />
                Connected Accounts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold mb-2">{accounts.length}</div>
              <p className="text-muted-foreground text-sm mb-4">
                Bank accounts linked via Plaid
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/admin/accounting/banks">
                  Manage Connections
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="h-5 w-5" />
                Recent Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {transactionsLoading ? (
                <Skeleton className="h-20 w-full" />
              ) : recentTransactions.length > 0 ? (
                <div className="space-y-2">
                  {recentTransactions.slice(0, 3).map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between text-sm">
                      <span className="truncate max-w-[120px]">{tx.name}</span>
                      <span className={parseFloat(tx.amount) < 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatCurrency(parseFloat(tx.amount))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-sm">No recent transactions</p>
              )}
              <Button variant="outline" size="sm" className="w-full mt-4" asChild>
                <Link href="/admin/accounting/transactions">
                  View All
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {(summary?.unallocatedCount || 0) > 0 && (
          <Card className="border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/20">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                Action Required
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm mb-4">
                You have <strong>{summary?.unallocatedCount}</strong> transactions 
                totaling <strong>{formatCurrency(summary?.unallocatedAmount || 0)}</strong> that 
                need to be categorized for accurate financial reporting.
              </p>
              <Button asChild>
                <Link href="/admin/accounting/transactions?filter=unallocated">
                  Review Unallocated Transactions
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </StaffLayout>
  );
}
