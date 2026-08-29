import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StaffLayout } from "@/components/staff/staff-layout";

/**
 * Revenue numbers for tax filings, from our own order data (not QuickBooks).
 * Monthly card mirrors the MyDOR combined excise return lines (retailing gross,
 * wholesaling gross, retail sales tax collected); the quarter table below feeds
 * the Seattle B&O return. Refundable deposits are excluded from gross on purpose —
 * they're a liability, not income.
 */

type MonthRow = {
  month: string;
  retail: { orders: number; gross: string; tax: string; deposits: string };
  wholesale: { orders: number; gross: string };
};

const fmt = (n: string | number) =>
  Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" });

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
};

function defaultMonth() {
  // Filings cover the PRIOR month, so default there.
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function FilingNumbers() {
  const [month, setMonth] = useState(defaultMonth);

  const { data, isLoading, error } = useQuery<{ quarter: string; months: MonthRow[] }>({
    queryKey: ["/api/admin/filing-numbers", month],
    queryFn: async () => {
      const res = await fetch(`/api/admin/filing-numbers?month=${month}`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json()).message || "Failed to load");
      return res.json();
    },
    enabled: /^\d{4}-\d{2}$/.test(month),
  });

  const selected = data?.months.find((m) => m.month === month);
  const qTotals = data?.months.reduce(
    (acc, m) => ({
      retail: acc.retail + Number(m.retail.gross),
      wholesale: acc.wholesale + Number(m.wholesale.gross),
      tax: acc.tax + Number(m.retail.tax),
    }),
    { retail: 0, wholesale: 0, tax: 0 }
  );

  return (
    <StaffLayout>
      <div className="max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Filing Numbers</h1>
          <p className="text-muted-foreground mt-1">
            Revenue from our own orders, shaped to the DOR excise and Seattle B&amp;O returns.
          </p>
        </div>

        <div className="max-w-xs">
          <Label htmlFor="filing-month">Filing month</Label>
          <Input
            id="filing-month"
            type="month"
            className="mt-1.5"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            data-testid="input-filing-month"
          />
        </div>

        {error && <p className="text-destructive text-sm">{(error as Error).message}</p>}
        {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}

        {selected && (
          <Card data-testid="card-dor-month">
            <CardHeader>
              <p className="text-xs font-semibold tracking-wider uppercase text-cedar">WA DOR combined excise return</p>
              <CardTitle>{monthLabel(selected.month)}</CardTitle>
              <CardDescription>Due the 25th of the following month in MyDOR.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3">
                <Row label="Retailing gross (B&O retailing + retail sales)" hint={`${selected.retail.orders} retail orders`} value={fmt(selected.retail.gross)} testid="dor-retail-gross" />
                <Row label="Wholesaling gross (B&O wholesaling)" hint={`${selected.wholesale.orders} wholesale invoices`} value={fmt(selected.wholesale.gross)} testid="dor-wholesale-gross" />
                <Row label="Retail sales tax collected" value={fmt(selected.retail.tax)} testid="dor-sales-tax" />
              </dl>
              {Number(selected.retail.deposits) > 0 && (
                <p className="text-xs text-muted-foreground mt-4">
                  {fmt(selected.retail.deposits)} in refundable container deposits collected — excluded from gross (liability, not income).
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {data && qTotals && (
          <Card data-testid="card-seattle-quarter">
            <CardHeader>
              <p className="text-xs font-semibold tracking-wider uppercase text-cedar">Seattle B&amp;O</p>
              <CardTitle>{data.quarter}</CardTitle>
              <CardDescription>Quarter containing the selected month. File via FileLocal.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground border-b">
                      <th className="py-2 pr-4 font-medium">Month</th>
                      <th className="py-2 pr-4 font-medium text-right">Retailing</th>
                      <th className="py-2 pr-4 font-medium text-right">Wholesaling</th>
                      <th className="py-2 font-medium text-right">Sales tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.months.map((m) => (
                      <tr key={m.month} className="border-b last:border-0" data-testid={`row-${m.month}`}>
                        <td className="py-2 pr-4">{monthLabel(m.month)}</td>
                        <td className="py-2 pr-4 text-right">{fmt(m.retail.gross)}</td>
                        <td className="py-2 pr-4 text-right">{fmt(m.wholesale.gross)}</td>
                        <td className="py-2 text-right">{fmt(m.retail.tax)}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="py-2 pr-4">Quarter total</td>
                      <td className="py-2 pr-4 text-right" data-testid="q-retail">{fmt(qTotals.retail)}</td>
                      <td className="py-2 pr-4 text-right" data-testid="q-wholesale">{fmt(qTotals.wholesale)}</td>
                      <td className="py-2 text-right" data-testid="q-tax">{fmt(qTotals.tax)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Months are Pacific-time calendar months by order date. Cancelled and deleted orders are excluded.
          Wholesale is resale — no sales tax. Cross-check against your accountant's numbers before filing.
        </p>
      </div>
    </StaffLayout>
  );
}

function Row({ label, hint, value, testid }: { label: string; hint?: string; value: string; testid: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-sm">
        {label}
        {hint && <span className="text-muted-foreground"> · {hint}</span>}
      </dt>
      <dd className="text-base font-semibold tabular-nums" data-testid={testid}>{value}</dd>
    </div>
  );
}
