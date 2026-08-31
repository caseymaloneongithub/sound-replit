import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Loader2, Search, Plus } from "lucide-react";
import type { Material, Supplier } from "@shared/schema";

type EnrichedMaterial = Material & {
  supplierName: string | null;
  supplierLeadTimeDays: number | null;
};

const n = (v: string | number | null | undefined) => {
  const x = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(x) ? x : 0;
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

// Legacy health thresholds: stock ÷ order_size — >0.8 healthy, ≥0.5 watch, else reorder
type Health = { key: "healthy" | "watch" | "reorder" | "na"; label: string; ratio: number | null };
function health(m: EnrichedMaterial): Health {
  const stock = n(m.stock);
  const size = n(m.orderSize);
  if (size <= 0) return { key: "na", label: "No target", ratio: null };
  const ratio = stock / size;
  if (ratio > 0.8) return { key: "healthy", label: "Healthy", ratio };
  if (ratio >= 0.5) return { key: "watch", label: "Watch", ratio };
  return { key: "reorder", label: "Reorder", ratio };
}

const HEALTH_STYLES: Record<Health["key"], string> = {
  healthy: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  watch: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  reorder: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  na: "bg-muted text-muted-foreground",
};
const BAR_COLORS: Record<Health["key"], string> = {
  healthy: "bg-green-500",
  watch: "bg-amber-500",
  reorder: "bg-red-500",
  na: "bg-muted-foreground/40",
};

// Titles are namespaced "Category:Name" (e.g. "Packaging:Bottles")
function splitTitle(title: string): { category: string; name: string } {
  const idx = title.indexOf(":");
  if (idx === -1) return { category: "Uncategorized", name: title };
  return { category: title.slice(0, idx).trim(), name: title.slice(idx + 1).trim() };
}

const UNCATEGORIZED = "Uncategorized";

function MaterialForm({
  material,
  suppliers,
  onClose,
}: {
  material?: EnrichedMaterial;
  suppliers: Supplier[];
  onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!material;
  const [title, setTitle] = useState(material?.title ?? "");
  const [unit, setUnit] = useState(material?.unit ?? "");
  const [cost, setCost] = useState(material ? String(n(material.cost)) : "0");
  const [stock, setStock] = useState(material ? String(n(material.stock)) : "0");
  const [orderSize, setOrderSize] = useState(material ? String(n(material.orderSize)) : "0");
  const [supplierId, setSupplierId] = useState<string>(material?.supplierId ?? "none");

  const save = useMutation({
    mutationFn: async () => {
      // Stock is only settable when CREATING a material (its opening balance). Editing
      // stock on an existing material goes through "Record count", which keeps a ledger —
      // the server rejects stock on PATCH for exactly that reason.
      const body: Record<string, unknown> = {
        title,
        unit,
        cost: String(n(cost)),
        orderSize: String(n(orderSize)),
        supplierId: supplierId === "none" ? null : supplierId,
      };
      if (!isEdit) body.stock = String(n(stock));
      return isEdit
        ? apiRequest("PATCH", `/api/materials/${material!.id}`, body)
        : apiRequest("POST", "/api/materials", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      toast({ title: isEdit ? "Material updated" : "Material created" });
      onClose();
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const canSave = title.trim().length > 0 && unit.trim().length > 0;

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">Title</label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Packaging:Bottles"
          data-testid="input-material-title"
        />
        <p className="text-xs text-muted-foreground">
          Use <code>Category:Name</code> to group (e.g. <code>Ingredients:Sugar</code>).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Unit</label>
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="e.g. lb, case, cap"
            data-testid="input-material-unit"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Supplier</label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger data-testid="select-material-supplier">
              <SelectValue placeholder="Select supplier" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— None —</SelectItem>
              {suppliers.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Cost / unit</label>
          <Input type="number" step="0.0001" min="0" value={cost}
            onChange={(e) => setCost(e.target.value)} data-testid="input-material-cost" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">{isEdit ? "On hand" : "Opening stock"}</label>
          {isEdit ? (
            <div className="h-10 flex items-center text-sm tabular-nums" title="Use Record count to change stock">
              {n(stock).toLocaleString()} <span className="text-muted-foreground ml-1">{unit}</span>
            </div>
          ) : (
            <Input type="number" step="0.0001" min="0" value={stock}
              onChange={(e) => setStock(e.target.value)} data-testid="input-material-stock" />
          )}
          {isEdit && <p className="text-xs text-muted-foreground">Change stock with Record count, so the change is logged.</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Reorder size</label>
          <Input type="number" step="0.0001" min="0" value={orderSize}
            onChange={(e) => setOrderSize(e.target.value)} data-testid="input-material-ordersize" />
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!canSave || save.isPending}
          data-testid="button-save-material">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isEdit ? "Save changes" : "Create material"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * Record a physical count for one material. Sets the shelf number and logs the delta
 * against what the system believed — the ledger entry is the whole point of doing it
 * this way instead of editing the number.
 */
function CountDialog({ material, onClose }: { material: EnrichedMaterial | null; onClose: () => void }) {
  const { toast } = useToast();
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const current = material ? n(material.stock) : 0;
  const countedNum = counted === "" ? null : Number(counted);
  const delta = countedNum === null || !Number.isFinite(countedNum) ? null : countedNum - current;

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", `/api/materials/${material!.id}/count`, { counted: countedNum, note: note || null, reason: "count" }),
    onSuccess: () => {
      toast({
        title: "Count recorded",
        description: delta === 0
          ? `${material!.title} matched the system exactly.`
          : `${material!.title}: ${current.toLocaleString()} → ${countedNum!.toLocaleString()} ${material!.unit} (${delta! > 0 ? "+" : ""}${delta!.toLocaleString()}).`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/reorder-report"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/limit-report"] });
      setCounted(""); setNote(""); onClose();
    },
    onError: (e: any) => toast({ title: "Couldn't record count", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={!!material} onOpenChange={(o) => { if (!o) { setCounted(""); setNote(""); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record count — {material ? splitTitle(material.title).name : ""}</DialogTitle>
          <DialogDescription>
            System has <span className="font-medium text-foreground tabular-nums">{current.toLocaleString()} {material?.unit}</span>.
            Enter what you actually counted; the difference is logged.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <label className="text-sm font-medium">Counted quantity ({material?.unit})</label>
            <Input type="number" step="0.0001" min="0" autoFocus value={counted}
              onChange={(e) => setCounted(e.target.value)} placeholder={String(current)}
              data-testid="input-count-quantity" />
            {delta !== null && (
              <p className={`text-sm tabular-nums ${delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                {delta === 0 ? "Matches the system." : `${delta > 0 ? "+" : ""}${delta.toLocaleString()} ${material?.unit} vs system`}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Note (optional)</label>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly count, found a spilled bag" data-testid="input-count-note" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { setCounted(""); setNote(""); onClose(); }}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={countedNum === null || !Number.isFinite(countedNum) || countedNum < 0 || save.isPending}
            data-testid="button-save-count">
            {save.isPending ? "Saving…" : "Record count"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

export default function Materials() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<EnrichedMaterial | null>(null);
  const [counting, setCounting] = useState<EnrichedMaterial | null>(null);

  const { data: materials = [], isLoading } = useQuery<EnrichedMaterial[]>({
    queryKey: ["/api/materials"],
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/materials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      toast({ title: "Material deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const m of materials) set.add(splitTitle(m.title).category);
    return Array.from(set).sort();
  }, [materials]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      const { category: cat } = splitTitle(m.title);
      if (category !== "all" && cat !== category) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [materials, search, category]);

  const stats = useMemo(() => {
    let value = 0, reorder = 0, watch = 0;
    for (const m of materials) {
      value += n(m.stock) * n(m.cost);
      const h = health(m).key;
      if (h === "reorder") reorder++;
      else if (h === "watch") watch++;
    }
    return { value, reorder, watch, total: materials.length };
  }, [materials]);

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
            <h1 className="text-3xl font-bold mb-1" data-testid="text-materials-title">Materials</h1>
            <p className="text-muted-foreground">
              Raw process inputs and current stock on hand
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-material">
            <Plus className="w-4 h-4 mr-2" /> Add material
          </Button>
        </div>

        {/* Insight summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <StatCard label="Materials tracked" value={String(stats.total)} />
          <StatCard label="Need reordering" value={String(stats.reorder)} />
          <StatCard label="Running low (watch)" value={String(stats.watch)} />
          <StatCard label="Inventory value" value={money(stats.value)} />
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Search materials…" value={search}
              onChange={(e) => setSearch(e.target.value)} data-testid="input-material-search" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-full sm:w-56" data-testid="select-category-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Material</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Reorder at size</TableHead>
                  <TableHead className="text-right">Cost / unit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="w-44">Stock health</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-10">
                      No materials match your filters.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((m) => {
                  const { category: cat, name } = splitTitle(m.title);
                  const h = health(m);
                  const pct = h.ratio === null ? 0 : Math.min(100, Math.round(h.ratio * 100));
                  return (
                    <TableRow key={m.id} data-testid={`row-material-${m.id}`}>
                      <TableCell>
                        <div className="font-medium">{name}</div>
                        {cat !== UNCATEGORIZED && (
                          <Badge variant="secondary" className="mt-1 text-xs">{cat}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {m.supplierName ? (
                          <div>
                            <div className="text-sm">{m.supplierName}</div>
                            {m.supplierLeadTimeDays != null && (
                              <div className="text-xs text-muted-foreground flex items-center gap-1">
                                {m.supplierLeadTimeDays}d lead
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n(m.stock).toLocaleString()} <span className="text-muted-foreground text-xs">{m.unit}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {n(m.orderSize).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(n(m.cost))}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {money(n(m.stock) * n(m.cost))}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge className={`${HEALTH_STYLES[h.key]} border-0`}>{h.label}</Badge>
                          {h.ratio !== null && (
                            <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
                          )}
                        </div>
                        <div className="mt-1 h-1.5 w-full rounded bg-muted overflow-hidden">
                          <div className={`h-full ${BAR_COLORS[h.key]}`} style={{ width: `${pct}%` }} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setCounting(m)}
                          data-testid={`button-count-material-${m.id}`}>
                          Count
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(m)}
                          data-testid={`button-edit-material-${m.id}`}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (confirm(`Delete "${m.title}"?`)) del.mutate(m.id);
                          }}
                          data-testid={`button-delete-material-${m.id}`}>
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add material</DialogTitle>
            <DialogDescription>Track a new raw process input.</DialogDescription>
          </DialogHeader>
          <MaterialForm suppliers={suppliers} onClose={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <CountDialog material={counting} onClose={() => setCounting(null)} />

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit material</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          {editing && (
            <MaterialForm material={editing} suppliers={suppliers} onClose={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
