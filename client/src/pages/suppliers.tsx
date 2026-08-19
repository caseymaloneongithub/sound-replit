import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Plus, Search } from "lucide-react";
import type { Supplier } from "@shared/schema";

function SupplierForm({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const { toast } = useToast();
  const isEdit = !!supplier;
  const [name, setName] = useState(supplier?.name ?? "");
  const [website, setWebsite] = useState(supplier?.website ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(String(supplier?.leadTimeDays ?? 14));
  const [notes, setNotes] = useState(supplier?.notes ?? "");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        name,
        website: website.trim() || null,
        email: email.trim() || null,
        leadTimeDays: parseInt(leadTimeDays, 10) || 0,
        notes: notes.trim() || null,
      };
      return isEdit
        ? apiRequest("PATCH", `/api/suppliers/${supplier!.id}`, body)
        : apiRequest("POST", "/api/suppliers", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: isEdit ? "Supplier updated" : "Supplier created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Berlin Packaging" data-testid="input-supplier-name" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Website</label>
          <Input value={website} onChange={(e) => setWebsite(e.target.value)}
            placeholder="example.com" data-testid="input-supplier-website" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Email</label>
          <Input value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="orders@example.com" data-testid="input-supplier-email" />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Lead time (days)</label>
        <Input type="number" min="0" value={leadTimeDays}
          onChange={(e) => setLeadTimeDays(e.target.value)} data-testid="input-supplier-leadtime" />
        <p className="text-xs text-muted-foreground">Typical days from placing an order to delivery.</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Notes</label>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder="Account number, contact, etc." data-testid="input-supplier-notes" />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}
          data-testid="button-save-supplier">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isEdit ? "Save changes" : "Create supplier"}
        </Button>
      </DialogFooter>
    </div>
  );
}

export default function Suppliers() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);

  const { data: suppliers = [], isLoading } = useQuery<Supplier[]>({
    queryKey: ["/api/suppliers"],
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/suppliers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/suppliers"] });
      toast({ title: "Supplier deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => s.name.toLowerCase().includes(q));
  }, [suppliers, search]);

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
            <h1 className="text-3xl font-bold mb-1" data-testid="text-suppliers-title">Suppliers</h1>
            <p className="text-muted-foreground">Vendors you order raw materials from</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-supplier">
            <Plus className="w-4 h-4 mr-2" /> Add supplier
          </Button>
        </div>

        <div className="relative mb-4 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search suppliers…" value={search}
            onChange={(e) => setSearch(e.target.value)} data-testid="input-supplier-search" />
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Lead time</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                      No suppliers yet.
                    </TableCell>
                  </TableRow>
                )}
                {filtered.map((s) => (
                  <TableRow key={s.id} data-testid={`row-supplier-${s.id}`}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell>
                      <div className="space-y-0.5 text-sm">
                        {s.website && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            {s.website}
                          </div>
                        )}
                        {s.email && (
                          <div className="flex items-center gap-1 text-muted-foreground">
                            {s.email}
                          </div>
                        )}
                        {!s.website && !s.email && <span className="text-muted-foreground">—</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-sm">
                        {s.leadTimeDays}d
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                      {s.notes || "—"}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(s)}
                        data-testid={`button-edit-supplier-${s.id}`}>Edit</Button>
                      <Button variant="ghost" size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => { if (confirm(`Delete supplier "${s.name}"?`)) del.mutate(s.id); }}
                        data-testid={`button-delete-supplier-${s.id}`}>Delete</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add supplier</DialogTitle>
            <DialogDescription>Add a vendor you order materials from.</DialogDescription>
          </DialogHeader>
          <SupplierForm onClose={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
            <DialogDescription>{editing?.name}</DialogDescription>
          </DialogHeader>
          {editing && <SupplierForm supplier={editing} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
