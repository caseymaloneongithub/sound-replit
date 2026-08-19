import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Loader2, Plus, Trash2, PackageCheck, Check,
} from "lucide-react";
import type { Supplier } from "@shared/schema";

type POLine = {
  id: string; orderId: string; materialId: string; units: string; delivered: boolean;
  materialTitle: string; materialUnit: string;
};
type PurchaseOrder = {
  id: string; supplierId: string; dateOrdered: string; dateDelivered: string | null;
  cost: string; notes: string | null; supplierName: string | null; lines: POLine[];
};
type MaterialLite = { id: string; title: string; unit: string };

const n = (v: string | number | null | undefined) => {
  const x = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(x) ? x : 0;
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-US",
  { year: "numeric", month: "short", day: "numeric" });
const todayISO = () => new Date().toISOString().slice(0, 10);
const shortMaterial = (t: string) => {
  const i = t.indexOf(":");
  return i === -1 ? t : t.slice(i + 1).trim();
};

function orderStatus(o: PurchaseOrder): { label: string; cls: string } {
  if (o.lines.length === 0) return { label: "No items", cls: "bg-muted text-muted-foreground" };
  const delivered = o.lines.filter((l) => l.delivered).length;
  if (delivered === o.lines.length)
    return { label: "Delivered", cls: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" };
  if (delivered === 0)
    return { label: "Pending", cls: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300" };
  return { label: `Partial ${delivered}/${o.lines.length}`, cls: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" };
}

function CreateOrderForm({ suppliers, materials, onClose }: {
  suppliers: Supplier[]; materials: MaterialLite[]; onClose: () => void;
}) {
  const { toast } = useToast();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [dateOrdered, setDateOrdered] = useState(todayISO());
  const [cost, setCost] = useState("0");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ materialId: string; units: string }[]>([
    { materialId: "", units: "" },
  ]);

  const setLine = (i: number, patch: Partial<{ materialId: string; units: string }>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { materialId: "", units: "" }]);
  const removeLine = (i: number) => setLines((ls) => ls.filter((_, idx) => idx !== i));

  const validLines = lines.filter((l) => l.materialId && n(l.units) > 0);

  const save = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/material-orders", {
        supplierId,
        dateOrdered,
        cost: String(n(cost)),
        notes: notes.trim() || null,
        lines: validLines.map((l) => ({ materialId: l.materialId, units: String(n(l.units)) })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/material-orders"] });
      toast({ title: "Purchase order created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Supplier</label>
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger data-testid="select-po-supplier"><SelectValue placeholder="Supplier" /></SelectTrigger>
            <SelectContent>
              {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Date ordered</label>
          <Input type="date" value={dateOrdered} onChange={(e) => setDateOrdered(e.target.value)}
            data-testid="input-po-date" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium">Line items</label>
        <div className="space-y-2">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2 items-center">
              <div className="flex-1">
                <Select value={l.materialId} onValueChange={(v) => setLine(i, { materialId: v })}>
                  <SelectTrigger data-testid={`select-po-material-${i}`}>
                    <SelectValue placeholder="Material" />
                  </SelectTrigger>
                  <SelectContent>
                    {materials.map((m) => (
                      <SelectItem key={m.id} value={m.id}>{shortMaterial(m.title)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input className="w-28" type="number" step="0.01" min="0" placeholder="Units"
                value={l.units} onChange={(e) => setLine(i, { units: e.target.value })}
                data-testid={`input-po-units-${i}`} />
              <Button variant="ghost" size="icon" onClick={() => removeLine(i)}
                disabled={lines.length === 1} data-testid={`button-po-removeline-${i}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={addLine} data-testid="button-po-addline">
          <Plus className="w-4 h-4 mr-1" /> Add line
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Total cost</label>
          <Input type="number" step="0.01" min="0" value={cost}
            onChange={(e) => setCost(e.target.value)} data-testid="input-po-cost" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Notes</label>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-po-notes" />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()}
          disabled={!supplierId || validLines.length === 0 || save.isPending}
          data-testid="button-save-po">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Create order
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

export default function PurchaseOrders() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);

  const { data: orders = [], isLoading } = useQuery<PurchaseOrder[]>({
    queryKey: ["/api/material-orders"],
  });
  const { data: suppliers = [] } = useQuery<Supplier[]>({ queryKey: ["/api/suppliers"] });
  const { data: materials = [] } = useQuery<MaterialLite[]>({ queryKey: ["/api/materials"] });

  const toggleLine = useMutation({
    mutationFn: async ({ lineId, delivered }: { lineId: string; delivered: boolean }) =>
      apiRequest("PATCH", `/api/material-orders/lines/${lineId}`, { delivered }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/material-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] }); // stock changed
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/material-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/material-orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] });
      toast({ title: "Purchase order deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const stats = useMemo(() => {
    let openCount = 0, onOrderValue = 0, awaitingLines = 0;
    for (const o of orders) {
      const delivered = o.lines.filter((l) => l.delivered).length;
      const isOpen = o.lines.length > 0 && delivered < o.lines.length;
      if (isOpen) {
        openCount++;
        onOrderValue += n(o.cost);
        awaitingLines += o.lines.length - delivered;
      }
    }
    return { openCount, onOrderValue, awaitingLines };
  }, [orders]);

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
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1" data-testid="text-po-title">Purchase Orders</h1>
            <p className="text-muted-foreground">
              Orders to suppliers — marking a line received adds it to material stock
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} disabled={suppliers.length === 0}
            data-testid="button-create-po">
            <Plus className="w-4 h-4 mr-2" /> New order
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <StatCard label="Open orders" value={String(stats.openCount)} />
          <StatCard label="Lines awaiting delivery" value={String(stats.awaitingLines)} />
          <StatCard label="Value on order" value={money(stats.onOrderValue)} />
        </div>

        {orders.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted-foreground">
            No purchase orders yet.
          </CardContent></Card>
        ) : (
          <div className="space-y-4">
            {orders.map((o) => {
              const status = orderStatus(o);
              return (
                <Card key={o.id} data-testid={`card-po-${o.id}`}>
                  <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-semibold">{o.supplierName ?? "Unknown supplier"}</span>
                      <Badge className={`${status.cls} border-0`}>{status.label}</Badge>
                      <span className="text-sm text-muted-foreground">Ordered {fmtDate(o.dateOrdered)}</span>
                      {n(o.cost) > 0 && <span className="text-sm font-medium">{money(n(o.cost))}</span>}
                    </div>
                    <Button variant="ghost" size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => { if (confirm("Delete this purchase order? Delivered stock will be reversed.")) del.mutate(o.id); }}
                      data-testid={`button-delete-po-${o.id}`}>Delete</Button>
                  </CardHeader>
                  <CardContent>
                    {o.notes && <p className="text-sm text-muted-foreground mb-3">{o.notes}</p>}
                    {o.lines.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No line items.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Material</TableHead>
                            <TableHead className="text-right">Units</TableHead>
                            <TableHead className="text-right w-40">Delivery</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {o.lines.map((l) => (
                            <TableRow key={l.id} data-testid={`row-po-line-${l.id}`}>
                              <TableCell className="text-sm">{shortMaterial(l.materialTitle)}</TableCell>
                              <TableCell className="text-right tabular-nums text-sm">
                                {n(l.units).toLocaleString()} <span className="text-muted-foreground text-xs">{l.materialUnit}</span>
                              </TableCell>
                              <TableCell className="text-right">
                                {l.delivered ? (
                                  <Button variant="ghost" size="sm" className="text-green-700"
                                    onClick={() => toggleLine.mutate({ lineId: l.id, delivered: false })}
                                    data-testid={`button-po-received-${l.id}`}>
                                    <Check className="w-4 h-4 mr-1" /> Received
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm"
                                    onClick={() => toggleLine.mutate({ lineId: l.id, delivered: true })}
                                    data-testid={`button-po-receive-${l.id}`}>
                                    <PackageCheck className="w-4 h-4 mr-1" /> Mark received
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New purchase order</DialogTitle>
            <DialogDescription>Order materials from a supplier. Mark lines received as they arrive.</DialogDescription>
          </DialogHeader>
          <CreateOrderForm suppliers={suppliers} materials={materials} onClose={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
