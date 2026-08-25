import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, MoreHorizontal } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RetailCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  subscriptionCount: number;
  activeSubscriptionCount: number;
}

type ShopProduct = {
  id: string;
  productType: string;
  productName: string | null;
  unitType: string;
  unitDescription: string;
  price: string;
  deposit: string;
  isActive: boolean;
  flavor: { id: string; name: string } | null;
  flavors: Array<{ id: string; name: string }>;
};

function welcomeToastFor(welcome: string, email: string) {
  if (welcome === "sent") return { title: "Welcome email sent", description: `${email} got a set-password link, good for 7 days.` };
  if (welcome === "suppressed") return { title: "Welcome email suppressed", description: "RETAIL_WELCOME_EMAILS isn't enabled in this environment — nothing was sent." };
  if (welcome === "no-email") return { title: "No email on file", description: "The account has no email address.", variant: "destructive" as const };
  return { title: "Customer added", description: `${email} — no welcome email requested.` };
}

export default function RetailCustomers() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [orderFor, setOrderFor] = useState<RetailCustomer | null>(null);

  const { data: customers, isLoading } = useQuery<RetailCustomer[]>({
    queryKey: ["/api/retail/customers", searchQuery],
    queryFn: async () => {
      const params = searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : "";
      const response = await fetch(`/api/retail/customers${params}`);
      if (!response.ok) throw new Error("Failed to fetch customers");
      return response.json();
    },
  });

  const sendWelcome = useMutation({
    mutationFn: async (c: RetailCustomer) => apiRequest("POST", `/api/retail/customers/${c.id}/send-welcome`),
    onSuccess: (res: any, c) => toast(welcomeToastFor(res.welcome, c.email)),
    onError: (e: any) => toast({ title: "Couldn't send welcome", description: e.message, variant: "destructive" }),
  });

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>
              Retail Customers
            </h1>
            <p className="text-muted-foreground">Add customers, import from Shopify, start orders</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-customers">Import CSV</Button>
            <Button onClick={() => setAddOpen(true)} data-testid="button-add-retail-customer">Add customer</Button>
          </div>
        </div>

        <div className="mb-6">
          <div className="relative max-w-md">
            <Input
              placeholder="Search by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-customers"
            />
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle style={{ fontFamily: "var(--font-heading)" }}>Customer Directory</CardTitle>
            <CardDescription>
              {customers && customers.length > 0
                ? `Showing ${customers.length} customer${customers.length === 1 ? "" : "s"}`
                : "No customers found"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : customers && customers.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Subscriptions</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.map((customer) => (
                      <TableRow key={customer.id} data-testid={`customer-row-${customer.id}`}>
                        <TableCell className="font-medium">
                          {customer.firstName} {customer.lastName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{customer.email}</TableCell>
                        <TableCell className="text-muted-foreground">{customer.phoneNumber}</TableCell>
                        <TableCell>
                          <div className="flex gap-2 flex-wrap">
                            <Badge variant="secondary" className="text-xs" data-testid={`badge-subscriptions-${customer.id}`}>
                              {customer.subscriptionCount}
                            </Badge>
                            {customer.activeSubscriptionCount > 0 && (
                              <Badge variant="default" className="text-xs" data-testid={`badge-active-${customer.id}`}>
                                {customer.activeSubscriptionCount} active
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" data-testid={`button-customer-actions-${customer.id}`}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => setOrderFor(customer)} data-testid={`button-new-order-${customer.id}`}>
                                New order
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => sendWelcome.mutate(customer)}
                                disabled={sendWelcome.isPending}
                                data-testid={`button-send-welcome-${customer.id}`}
                              >
                                Send welcome email
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-1">
                  {searchQuery ? "No customers match your search" : "No retail customers yet"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AddCustomerDialog open={addOpen} onOpenChange={setAddOpen} />
      <ImportCustomersDialog open={importOpen} onOpenChange={setImportOpen} />
      <NewOrderDialog customer={orderFor} onOpenChange={(o) => !o && setOrderFor(null)} />
    </StaffLayout>
  );
}

// ------------------------------------------------------------------------------------------

function AddCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "" });
  const [sendWelcome, setSendWelcome] = useState(true);

  const add = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/retail/customers", { ...form, sendWelcome }),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/retail/customers"] });
      toast(welcomeToastFor(res.welcome, form.email));
      setForm({ firstName: "", lastName: "", email: "", phone: "" });
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't add customer", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add retail customer</DialogTitle>
          <DialogDescription>They'll sign in with their email and the password they set from the welcome link.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="rc-first">First name</Label>
              <Input id="rc-first" value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} data-testid="input-customer-first" />
            </div>
            <div>
              <Label htmlFor="rc-last">Last name</Label>
              <Input id="rc-last" value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} data-testid="input-customer-last" />
            </div>
          </div>
          <div>
            <Label htmlFor="rc-email">Email</Label>
            <Input id="rc-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} data-testid="input-customer-email" />
          </div>
          <div>
            <Label htmlFor="rc-phone">Phone</Label>
            <Input id="rc-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} data-testid="input-customer-phone" />
          </div>
          <label className="flex items-start gap-2 pt-1 text-sm">
            <Checkbox checked={sendWelcome} onCheckedChange={(v) => setSendWelcome(v === true)} className="mt-0.5" data-testid="checkbox-send-welcome" />
            <span>
              Send welcome email
              <span className="block text-xs text-muted-foreground">"You've been added to our new ordering system" with a set-password link (good for 7 days).</span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-add-customer">Cancel</Button>
          <Button onClick={() => add.mutate()} disabled={add.isPending || !form.firstName.trim() || !form.email.trim()} data-testid="button-save-customer">
            {add.isPending ? "Adding…" : "Add customer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

/** Parses a Shopify customer export (or any CSV with First Name / Last Name / Email / Phone). */
function parseCustomerCsv(text: string): Array<{ firstName: string; lastName: string; email: string; phone: string }> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const parseLine = (line: string) => {
    const values: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) { values.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    values.push(cur.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => headers.findIndex((h) => names.some((n) => h === n || h.includes(n)));
  const iFirst = col("first name", "firstname");
  const iLast = col("last name", "lastname");
  const iEmail = col("email");
  const iPhone = col("phone");
  if (iEmail < 0) return [];
  return lines.slice(1).map(parseLine).map((v) => ({
    firstName: iFirst >= 0 ? v[iFirst] || "" : "",
    lastName: iLast >= 0 ? v[iLast] || "" : "",
    email: v[iEmail] || "",
    phone: iPhone >= 0 ? v[iPhone] || "" : "",
  }));
}

function ImportCustomersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);

  const run = useMutation({
    mutationFn: async () => {
      const rows = parseCustomerCsv(await file!.text());
      if (rows.length === 0) throw new Error("No usable rows — the CSV needs a header row with at least an Email column.");
      return apiRequest("POST", "/api/retail/customers/import", { rows });
    },
    onSuccess: (res: any) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ["/api/retail/customers"] });
    },
    onError: (e: any) => toast({ title: "Import failed", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFile(null); setResult(null); } }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Import customers from Shopify</DialogTitle>
          <DialogDescription>
            Shopify admin → Customers → Export → CSV. Existing emails are skipped, never overwritten.
            No emails are sent by the import — use "Send welcome email" on a customer when you're ready.
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-2 text-sm" data-testid="text-import-result">
            <p><span className="font-semibold">{result.imported}</span> imported · <span className="font-semibold">{result.skipped}</span> already existed{result.errors.length > 0 ? <> · <span className="font-semibold">{result.errors.length}</span> rejected</> : null}</p>
            {result.errors.length > 0 && (
              <ul className="list-disc pl-5 max-h-32 overflow-y-auto text-muted-foreground">
                {result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        ) : (
          <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="input-customers-csv" />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-import">{result ? "Done" : "Cancel"}</Button>
          {!result && (
            <Button onClick={() => run.mutate()} disabled={!file || run.isPending} data-testid="button-run-import">
              {run.isPending ? "Importing…" : "Import"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------------------------

type OrderLine = { retailProductId: string; selectedFlavorId: string; quantity: number };

function NewOrderDialog({ customer, onOpenChange }: { customer: RetailCustomer | null; onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const [lines, setLines] = useState<OrderLine[]>([{ retailProductId: "", selectedFlavorId: "", quantity: 1 }]);
  const [pickupDate, setPickupDate] = useState("");
  const [notes, setNotes] = useState("");

  const { data: products = [] } = useQuery<ShopProduct[]>({
    queryKey: ["/api/retail-products"],
    enabled: !!customer,
  });
  const active = products.filter((p) => p.isActive);
  const byId = useMemo(() => new Map(active.map((p) => [p.id, p])), [active]);

  const total = lines.reduce((sum, l) => {
    const p = byId.get(l.retailProductId);
    return p ? sum + (Number(p.price) + Number(p.deposit || 0)) * l.quantity : sum;
  }, 0);

  const reset = () => { setLines([{ retailProductId: "", selectedFlavorId: "", quantity: 1 }]); setPickupDate(""); setNotes(""); };

  const create = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/retail/orders", {
        userId: customer!.id,
        items: lines
          .filter((l) => l.retailProductId)
          .map((l) => ({ retailProductId: l.retailProductId, selectedFlavorId: l.selectedFlavorId || null, quantity: l.quantity })),
        pickupDate: pickupDate || null,
        notes: notes || undefined,
      }),
    onSuccess: (order: any) => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/retail/orders") });
      queryClient.invalidateQueries({ queryKey: ["/api/staff/orders-board"] });
      toast({ title: `Order ${order.orderNumber} created`, description: `$${Number(order.totalAmount).toFixed(2)} — pay at pickup.` });
      reset();
      onOpenChange(false);
    },
    onError: (e: any) => toast({ title: "Couldn't create order", description: e.message, variant: "destructive" }),
  });

  const setLine = (i: number, patch: Partial<OrderLine>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const canSave = lines.some((l) => l.retailProductId) && lines.every((l) => {
    if (!l.retailProductId) return true;
    const p = byId.get(l.retailProductId);
    return !p || p.productType !== "multi-flavor" || !!l.selectedFlavorId;
  });

  return (
    <Dialog open={!!customer} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            {customer ? `${customer.firstName} ${customer.lastName} (${customer.email})` : ""} — staff-entered, pay at pickup. Shows on the orders board once it has a pickup date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {lines.map((line, i) => {
            const p = line.retailProductId ? byId.get(line.retailProductId) : undefined;
            return (
              <div key={i} className="flex flex-wrap items-end gap-2" data-testid={`order-line-${i}`}>
                <div className="flex-1 min-w-[180px]">
                  <Label>Product</Label>
                  <Select value={line.retailProductId} onValueChange={(v) => setLine(i, { retailProductId: v, selectedFlavorId: "" })}>
                    <SelectTrigger data-testid={`select-product-${i}`}><SelectValue placeholder="Choose…" /></SelectTrigger>
                    <SelectContent>
                      {active.map((prod) => (
                        <SelectItem key={prod.id} value={prod.id}>
                          {(prod.productName || prod.flavor?.name || prod.unitType) + ` — ${prod.unitDescription} ($${Number(prod.price).toFixed(2)})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {p?.productType === "multi-flavor" && p.flavors.length > 0 && (
                  <div className="w-40">
                    <Label>Flavor</Label>
                    <Select value={line.selectedFlavorId} onValueChange={(v) => setLine(i, { selectedFlavorId: v })}>
                      <SelectTrigger data-testid={`select-flavor-${i}`}><SelectValue placeholder="Flavor…" /></SelectTrigger>
                      <SelectContent>
                        {p.flavors.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="w-20">
                  <Label>Qty</Label>
                  <Input
                    inputMode="numeric"
                    value={String(line.quantity)}
                    onChange={(e) => setLine(i, { quantity: Math.max(1, Math.min(50, Number(e.target.value.replace(/\D/g, "")) || 1)) })}
                    data-testid={`input-qty-${i}`}
                  />
                </div>
              </div>
            );
          })}
          <Button variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { retailProductId: "", selectedFlavorId: "", quantity: 1 }])} data-testid="button-add-line">
            + Add item
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ro-pickup">Pickup date</Label>
              <Input id="ro-pickup" type="date" value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} data-testid="input-pickup-date" />
            </div>
            <div className="flex items-end justify-end pb-1 text-sm text-muted-foreground">
              Total (incl. deposits): <span className="font-semibold text-foreground ml-1">${total.toFixed(2)}</span>
            </div>
          </div>
          <div>
            <Label htmlFor="ro-notes">Notes</Label>
            <Textarea id="ro-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} data-testid="input-order-notes" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-order">Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={!canSave || create.isPending} data-testid="button-create-order">
            {create.isPending ? "Creating…" : "Create order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
