import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { StaffLayout } from "@/components/staff/staff-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { Loader2 } from "lucide-react";

type Dashboard = {
  inventoryValue: number; totalMaterials: number; batchesLast30: number; casesLast30: number;
  flavorMix: { flavor: string; cases: number }[];
  monthly: { month: string; cases: number }[];
  negativeStock: { id: string; title: string; unit: string; stock: number }[];
};
type CogsReport = {
  windowDays: number;
  totalMaterialCost: number;
  byRecipe: { processId: string; title: string; flavorName: string | null; units: number; materialCost: number }[];
};
type LimitRow = {
  processId: string; title: string; unit: string;
  maxUnits: number | null;
  limiting: { materialId: string; title: string; unit: string; stock: number; perUnit: number } | null;
};
type ReorderRow = {
  id: string; title: string; unit: string; stock: number; supplierName: string | null;
  dailyUsage: number; daysOfCover: number | null; leadTimeDays: number;
  reorderPoint: number; suggestedQty: number; status: "order-now" | "watch" | "ok";
};

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
// Per-unit costs need cents — rounding $11.05 to "$11" hides the real margin.
const moneyPrecise = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(v);
const shortMaterial = (t: string) => {
  const i = t.indexOf(":");
  return i === -1 ? t : t.slice(i + 1).trim();
};
const PIE_COLORS = ["#f59e0b", "#ef4444", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#64748b"];

function StatCard({ label, value }: {
  label: string; value: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div>
          <div className="text-2xl font-bold leading-none">{value}</div>
          <div className="text-xs text-muted-foreground mt-1">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function InventoryDashboard() {
  const { data: dash, isLoading } = useQuery<Dashboard>({ queryKey: ["/api/inventory/dashboard"] });
  const { data: reorder = [] } = useQuery<ReorderRow[]>({ queryKey: ["/api/inventory/reorder-report"] });
  const { data: limits = [] } = useQuery<LimitRow[]>({ queryKey: ["/api/inventory/limit-report"] });
  const { data: cogs } = useQuery<CogsReport>({ queryKey: ["/api/inventory/cogs-report"] });
  const { data: finished = [] } = useQuery<Array<{ id: string; name: string; container: string; stockQuantity: number; flavor: string | null }>>({
    queryKey: ["/api/inventory/finished-goods"],
  });

  const alerts = useMemo(
    () =>
      reorder
        .filter((r) => r.status !== "ok")
        .sort((a, b) => {
          const rank = { "order-now": 0, watch: 1, ok: 2 } as const;
          if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
          return (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity);
        }),
    [reorder]
  );
  const orderNowCount = reorder.filter((r) => r.status === "order-now").length;

  if (isLoading || !dash) {
    return (
      <StaffLayout>
        <div className="flex items-center justify-center min-h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-1" data-testid="text-dashboard-title">Inventory Dashboard</h1>
          <p className="text-muted-foreground">Production trends, flavor mix, and what to reorder</p>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Inventory value" value={money(dash.inventoryValue)} />
          <StatCard label="Order now" value={String(orderNowCount)} />
          <StatCard label="Batches — last 30d" value={dash.batchesLast30.toLocaleString()} />
          <StatCard label="Cases — last 30d" value={dash.casesLast30.toLocaleString()} />
        </div>

        {/* Negative stock = the number is wrong. Usually a delivery never marked received. */}
        {dash.negativeStock?.length > 0 && (
          <Card className="mb-6 border-red-300 dark:border-red-900">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg text-red-700 dark:text-red-400">Stock below zero — needs a look</CardTitle>
              <CardDescription>
                A negative on-hand means a batch was logged against stock the system never saw arrive.
                Mark the delivery received on its purchase order, or record a count.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="text-sm space-y-1">
                {dash.negativeStock.map((m) => (
                  <li key={m.id} className="flex justify-between tabular-nums" data-testid={`negative-${m.id}`}>
                    <span>{shortMaterial(m.title)}</span>
                    <span className="text-red-700 dark:text-red-400 font-medium">{m.stock.toLocaleString()} {m.unit}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Reorder alerts */}
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              Reorder alerts
            </CardTitle>
            <CardDescription>
              Based on usage over the last 90 days vs. supplier lead time
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {alerts.length === 0 ? (
              <div className="flex items-center gap-2 text-muted-foreground px-6 py-8">
                Nothing needs reordering right now.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Material</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Usage / day</TableHead>
                    <TableHead className="text-right">Days of cover</TableHead>
                    <TableHead className="text-right">Lead time</TableHead>
                    <TableHead className="text-right">Suggested order</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((r) => (
                    <TableRow key={r.id} data-testid={`row-reorder-${r.id}`}>
                      <TableCell className="font-medium text-sm">{shortMaterial(r.title)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{r.supplierName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {Math.round(r.stock).toLocaleString()} <span className="text-muted-foreground text-xs">{r.unit}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{r.dailyUsage.toFixed(1)}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.daysOfCover === null ? "—" : `${Math.round(r.daysOfCover)}d`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">{r.leadTimeDays}d</TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {r.suggestedQty.toLocaleString()} {r.unit}
                      </TableCell>
                      <TableCell>
                        {r.status === "order-now" ? (
                          <Badge className="bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-0">Order now</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border-0">Watch</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-lg">
                Production — last 12 months
              </CardTitle>
              <CardDescription>Cases bottled per month</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={dash.monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="cases" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Cases" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Flavor mix</CardTitle>
              <CardDescription>Cases bottled by flavor (all time)</CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={dash.flavorMix}
                    cx="50%" cy="50%"
                    labelLine={false}
                    label={({ flavor, percent }) => `${flavor} ${(percent * 100).toFixed(0)}%`}
                    outerRadius={100}
                    dataKey="cases"
                    nameKey="flavor"
                  >
                    {dash.flavorMix.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`${v.toLocaleString()} cases`, ""]} />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        {/* Finished goods — what's packaged and on the shelf right now. Productions add
            to it; packaging a wholesale order or fulfilling a retail pickup subtracts.
            Negative means more left the shelf than the system saw arrive — the monthly
            count reconciles it. */}
        {finished.length > 0 && (
          <Card className="mt-6" data-testid="card-finished-goods">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Finished goods on the shelf</CardTitle>
              <CardDescription>
                Productions add to these; packaging an order subtracts. Negative numbers need a look.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 md:grid-cols-3">
                {([["bottle-case", "Bottle cases"], ["can-case", "Can cases"], ["keg-sixth", "1/6 kegs"]] as const).map(([key, title]) => {
                  const rows = finished.filter((p) => p.container === key);
                  if (rows.length === 0) return null;
                  return (
                    <div key={key}>
                      <div className="text-sm font-semibold mb-2">{title}</div>
                      <div className="rounded-md border divide-y">
                        {rows.map((p) => (
                          <StockRow key={p.id} product={p} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Production limits — what can we actually make with what's on the shelf */}
        {limits.length > 0 && (
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Production limits</CardTitle>
              <CardDescription>
                Maximum each recipe can produce from stock on hand, and the ingredient that
                runs out first. Scarcest at the top.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipe</TableHead>
                    <TableHead className="text-right">Can make</TableHead>
                    <TableHead>Limiting ingredient</TableHead>
                    <TableHead className="text-right">Its stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limits.map((r) => (
                    <TableRow key={r.processId} data-testid={`row-limit-${r.processId}`}>
                      {/* Keep the Brew:/Bottle: prefix — unlike material categories it
                          distinguishes two different recipes for the same flavor. */}
                      <TableCell className="text-sm">{r.title.replace(":", " · ")}</TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.maxUnits === null ? (
                          <span className="text-muted-foreground">no recipe lines</span>
                        ) : (
                          <span className={r.maxUnits === 0 ? "font-semibold text-red-600 dark:text-red-400" : "font-medium"}>
                            {r.maxUnits.toLocaleString()} {r.unit}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.limiting ? shortMaterial(r.limiting.title) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {r.limiting
                          ? `${r.limiting.stock.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${r.limiting.unit} (${r.limiting.perUnit.toLocaleString(undefined, { maximumFractionDigits: 4 })}/${r.unit})`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Cost of goods produced */}
        {cogs && cogs.byRecipe.length > 0 && (
          <Card className="mt-6">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">Cost of goods produced</CardTitle>
                  <CardDescription>
                    Material cost consumed by batches over the last {cogs.windowDays} days
                  </CardDescription>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">{money(cogs.totalMaterialCost)}</div>
                  <div className="text-xs text-muted-foreground">total material cost</div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Recipe</TableHead>
                    <TableHead className="text-right">Units produced</TableHead>
                    <TableHead className="text-right">Material cost</TableHead>
                    <TableHead className="text-right">Cost / unit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cogs.byRecipe.map((r) => (
                    <TableRow key={r.processId} data-testid={`row-cogs-${r.processId}`}>
                      <TableCell className="text-sm">
                        {r.title}
                        {r.flavorName && (
                          <Badge variant="secondary" className="ml-2 text-xs">{r.flavorName}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {r.units.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm font-medium">
                        {money(r.materialCost)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                        {r.units > 0 ? moneyPrecise(r.materialCost / r.units) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground px-6 py-3 border-t">
                Reporting only — supplier payments already post to the accounting ledger, so
                these costs are not booked again as expenses (that would double-count).
              </p>
            </CardContent>
          </Card>
        )}

        <div className="mt-6">
          <Link href="/inventory/materials">
            <Button variant="outline" data-testid="link-all-materials">View all materials →</Button>
          </Link>
        </div>
      </div>
    </StaffLayout>
  );
}

// One finished-goods row with an editable count — THE place to correct shelf stock
// after a physical count (the old Products tab is unreachable from the new nav).
function StockRow({ product }: { product: { id: string; name: string; container: string; stockQuantity: number; flavor: string | null } }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(product.stockQuantity));

  const save = useMutation({
    mutationFn: async () => {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new Error("Enter a whole number, 0 or more");
      return apiRequest("PATCH", `/api/inventory/${product.id}`, { stockQuantity: Math.round(n) });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/finished-goods"] });
      setEditing(false);
    },
  });

  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-sm" data-testid={`finished-${product.id}`}>
      <span>{product.flavor ?? product.name}</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            inputMode="numeric"
            className="w-16 rounded border bg-background px-1.5 py-0.5 text-right tabular-nums"
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") save.mutate();
              if (e.key === "Escape") { setEditing(false); setValue(String(product.stockQuantity)); }
            }}
            data-testid={`input-stock-${product.id}`}
          />
          <Button size="sm" variant="ghost" className="h-6 px-2" disabled={save.isPending} onClick={() => save.mutate()} data-testid={`save-stock-${product.id}`}>
            {save.isPending ? "…" : "Save"}
          </Button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => { setValue(String(product.stockQuantity)); setEditing(true); }}
          className={`font-medium tabular-nums underline decoration-dotted underline-offset-4 hover:text-primary ${product.stockQuantity < 0 ? "text-red-600 dark:text-red-400" : product.stockQuantity === 0 ? "text-muted-foreground" : ""}`}
          title="Click to set the count"
          data-testid={`edit-stock-${product.id}`}
        >
          {product.stockQuantity}
        </button>
      )}
    </div>
  );
}
