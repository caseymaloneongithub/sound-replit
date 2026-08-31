import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";

type Recipe = {
  id: string; title: string; unit: string; flavorName: string | null;
  finishedProductName: string | null;
  materials: { units: string; materialCost: string }[];
};
type Production = {
  id: string; processId: string; units: string; date: string;
  notes: string | null; processTitle: string; flavorName: string | null;
};

const n = (v: string | number | null | undefined) => {
  const x = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(x) ? x : 0;
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US",
  { year: "numeric", month: "short", day: "numeric" });
const todayISO = () => new Date().toISOString().slice(0, 10);

function LogProductionForm({ recipes, onClose }: { recipes: Recipe[]; onClose: () => void }) {
  const { toast } = useToast();
  const [processId, setProcessId] = useState<string>(recipes[0]?.id ?? "");
  const [units, setUnits] = useState("1");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");

  const recipe = recipes.find((r) => r.id === processId);
  const costPerUnit = recipe
    ? recipe.materials.reduce((s, m) => s + n(m.units) * n(m.materialCost), 0)
    : 0;

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/productions", {
        processId, units: String(n(units)), date, notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/productions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] }); // raw stock changed
      queryClient.invalidateQueries({ queryKey: ["/api/products"] }); // finished stock may have changed
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/dashboard"] });
      toast({
        title: "Production logged",
        description: recipe?.finishedProductName
          ? `Materials drawn down; ${recipe.finishedProductName} stock increased.`
          : "Material stock has been drawn down.",
      });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">Recipe</label>
        <Select value={processId} onValueChange={setProcessId}>
          <SelectTrigger data-testid="select-production-recipe">
            <SelectValue placeholder="Select a recipe" />
          </SelectTrigger>
          <SelectContent>
            {recipes.map((r) => (
              <SelectItem key={r.id} value={r.id}>{r.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Units produced {recipe ? `(${recipe.unit})` : ""}</label>
          <Input type="number" step="0.01" min="0" value={units}
            onChange={(e) => setUnits(e.target.value)} data-testid="input-production-units" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Date</label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            data-testid="input-production-date" />
        </div>
      </div>
      {recipe && (
        <div className="rounded-md bg-muted/50 p-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Estimated material cost</span>
            <span className="font-semibold tabular-nums">{money(costPerUnit * n(units))}</span>
          </div>
          {recipe.finishedProductName && (
            <div className="flex items-center justify-between text-green-700 dark:text-green-400">
              <span>Adds to finished stock</span>
              <span className="font-semibold tabular-nums">
                +{Math.round(n(units)).toLocaleString()} {recipe.finishedProductName}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium">Notes (optional)</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-production-notes" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!processId || n(units) <= 0 || save.isPending}
          data-testid="button-save-production">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Log production
        </Button>
      </DialogFooter>
    </div>
  );
}

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

export default function Productions() {
  const { toast } = useToast();
  const [logOpen, setLogOpen] = useState(false);

  const { data: productions = [], isLoading } = useQuery<Production[]>({
    queryKey: ["/api/productions"],
  });
  const { data: recipes = [] } = useQuery<Recipe[]>({
    queryKey: ["/api/processes"],
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/productions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/productions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/dashboard"] });
      toast({ title: "Production deleted", description: "Material and finished stock reversed." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const costPerUnitByProcess = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of recipes) {
      map.set(r.id, r.materials.reduce((s, m) => s + n(m.units) * n(m.materialCost), 0));
    }
    return map;
  }, [recipes]);

  const stats = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    let last30Units = 0;
    let last30Count = 0;
    for (const p of productions) {
      if (new Date(p.date) >= cutoff) {
        last30Units += n(p.units);
        last30Count += 1;
      }
    }
    return { last30Count, last30Units };
  }, [productions]);

  if (isLoading) {
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
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold mb-1" data-testid="text-productions-title">Productions</h1>
            <p className="text-muted-foreground">
              Log a batch — recording one draws down the raw materials it consumed
            </p>
          </div>
          <Button onClick={() => setLogOpen(true)} disabled={recipes.length === 0}
            data-testid="button-log-production">
            <Plus className="w-4 h-4 mr-2" /> Log production
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 max-w-md">
          <StatCard label="Batches — last 30 days" value={stats.last30Count.toLocaleString()} />
          <StatCard label="Units — last 30 days" value={stats.last30Units.toLocaleString()} />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Recipe</TableHead>
                  <TableHead className="text-right">Units</TableHead>
                  <TableHead className="text-right">Est. material cost</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No productions logged yet.
                    </TableCell>
                  </TableRow>
                )}
                {productions.map((p) => {
                  const cpu = costPerUnitByProcess.get(p.processId) ?? 0;
                  return (
                    <TableRow key={p.id} data-testid={`row-production-${p.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">{fmtDate(p.date)}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{p.processTitle}</span>
                          {p.flavorName && <Badge variant="secondary" className="text-xs">{p.flavorName}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n(p.units).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {cpu > 0 ? money(cpu * n(p.units)) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete this ${p.processTitle} batch? Materials will be restored to stock.`))
                              del.mutate(p.id);
                          }}
                          data-testid={`button-delete-production-${p.id}`}>Delete</Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Log production</DialogTitle>
            <DialogDescription>Record a completed batch. Stock is drawn down via the recipe.</DialogDescription>
          </DialogHeader>
          <LogProductionForm recipes={recipes} onClose={() => setLogOpen(false)} />
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
