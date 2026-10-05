import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import type { ShippingBox } from "@shared/schema";
import type { ShippingSettings } from "@shared/shipping-policy";
import { formatShipDate } from "@shared/shipping-policy";

type SettingsResponse = {
  settings: ShippingSettings;
  boxes: ShippingBox[];
  provider: { provider: "shippo" | "stub"; configured: boolean; testMode: boolean };
  stripeTax: { status: string; detail?: string };
  nextShipDate: string;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const dollars = (cents: number) => (cents / 100).toFixed(2);
const cents = (dollarsStr: string) => Math.round((parseFloat(dollarsStr) || 0) * 100);

/**
 * Shipping settings (owner, 2026-10-05): the boxes (dimensions, tare, ice packs and
 * the per-box packaging fee), the fee add-ons, the ship day, and the policy knobs.
 * Everything here used to be a constant; now it's the owner's to change, and a
 * change applies to the next quote (paid orders keep what they were quoted).
 */
export default function AdminShipping() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SettingsResponse>({ queryKey: ["/api/admin/shipping/settings"] });

  const [form, setForm] = useState<ShippingSettings | null>(null);
  useEffect(() => {
    if (data?.settings && !form) setForm(data.settings);
  }, [data?.settings, form]);

  const save = useMutation({
    mutationFn: async (patch: Partial<ShippingSettings>) => apiRequest("PUT", "/api/admin/shipping/settings", patch),
    onSuccess: (r: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/shipping/settings"] });
      setForm(r.settings);
      toast({ title: "Shipping settings saved" });
    },
    onError: (e: any) => toast({ title: "Couldn't save", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !form) {
    return (
      <StaffLayout>
        <div className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading shipping settings…</div>
      </StaffLayout>
    );
  }

  const provider = data!.provider;
  const stripeTax = data!.stripeTax;

  return (
    <StaffLayout>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-shipping-title">Shipping</h1>
            <p className="text-muted-foreground">Cans only, cold-packed, shipped on {WEEKDAYS[form.shipWeekday]}s. Next batch ships {formatShipDate(data!.nextShipDate)}.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge variant={provider.configured ? (provider.testMode ? "secondary" : "default") : "outline"} data-testid="badge-provider">
              {provider.configured ? `Shippo ${provider.testMode ? "test mode" : "live"}` : "No carrier key — test rates"}
            </Badge>
            <Badge variant={stripeTax.status === "active" ? "default" : "outline"} title={stripeTax.detail} data-testid="badge-stripe-tax">
              Stripe Tax: {stripeTax.status}
            </Badge>
          </div>
        </div>

        {!provider.configured && (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardContent className="pt-5 text-sm">
              <strong>Test rates are in use.</strong> Set <code>SHIPPO_API_KEY</code> on the server (a <code>shippo_test_</code> key buys free test labels; a live key buys real postage) to quote real carrier rates and print real labels.
            </CardContent>
          </Card>
        )}
        {stripeTax.status !== "active" && stripeTax.detail && (
          <Card className="border-amber-300 dark:border-amber-800">
            <CardContent className="pt-5 text-sm">{stripeTax.detail}</CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-3">
              <span>Offer shipping at checkout</span>
              <Switch checked={form.enabled} onCheckedChange={(v) => save.mutate({ enabled: v })} data-testid="switch-shipping-enabled" />
            </CardTitle>
            <CardDescription>
              Off hides the Ship option entirely; retail stays pickup-only. A keg in the cart, or a subscription, is pickup-only regardless.
            </CardDescription>
          </CardHeader>
        </Card>

        <BoxesCard boxes={data!.boxes} />

        <Card>
          <CardHeader>
            <CardTitle>Fees and policy</CardTitle>
            <CardDescription>The customer pays the carrier rate (after markup) plus each box's packaging fee plus the flat add-on, as one "Shipping &amp; handling" line.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Flat add-on per box ($)" hint="On top of each box's own packaging fee. 0 to skip.">
              <Input inputMode="decimal" value={dollars(form.flatFeeCents)} onChange={(e) => setForm({ ...form, flatFeeCents: cents(e.target.value) })} data-testid="input-flat-fee" />
            </Field>
            <Field label="Carrier rate markup (%)" hint="0 passes postage through at cost.">
              <Input inputMode="decimal" value={String(form.markupPercent)} onChange={(e) => setForm({ ...form, markupPercent: parseFloat(e.target.value) || 0 })} data-testid="input-markup" />
            </Field>
            <Field label="Max transit (days)" hint="Raw product: 2. Slower services are never offered.">
              <Input inputMode="numeric" value={String(form.maxTransitDays)} onChange={(e) => setForm({ ...form, maxTransitDays: parseInt(e.target.value) || 2 })} data-testid="input-max-transit" />
            </Field>
            <Field label="Ship day" hint="Orders placed after midnight before this day ship the following week.">
              <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.shipWeekday} onChange={(e) => setForm({ ...form, shipWeekday: parseInt(e.target.value) })} data-testid="select-ship-day">
                {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
            <Field label="Default can weight (oz)" hint="Used when a product has no can weight set. A full 16 oz can is about 17 oz.">
              <Input inputMode="decimal" value={String(form.defaultCanWeightOz)} onChange={(e) => setForm({ ...form, defaultCanWeightOz: parseFloat(e.target.value) || 17 })} data-testid="input-can-weight" />
            </Field>
            <Field label="Don't ship to (states)" hint="Two-letter codes, comma separated.">
              <Input value={form.excludedStates.join(", ")} onChange={(e) => setForm({ ...form, excludedStates: e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) })} data-testid="input-excluded-states" />
            </Field>
            <Field label="Stripe Tax product code" hint="Leave blank for the account default. Stripe lists codes under Tax → Settings.">
              <Input value={form.stripeTaxCode} onChange={(e) => setForm({ ...form, stripeTaxCode: e.target.value })} placeholder="e.g. txcd_99999999" data-testid="input-tax-code" />
            </Field>
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <Button onClick={() => save.mutate({ flatFeeCents: form.flatFeeCents, markupPercent: form.markupPercent, maxTransitDays: form.maxTransitDays, shipWeekday: form.shipWeekday, defaultCanWeightOz: form.defaultCanWeightOz, excludedStates: form.excludedStates, stripeTaxCode: form.stripeTaxCode })} disabled={save.isPending} data-testid="button-save-policy">
                {save.isPending ? "Saving…" : "Save fees and policy"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ship from</CardTitle>
            <CardDescription>Printed on every label and used to rate shipments.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              ["name", "Contact name"], ["company", "Company"], ["street1", "Street"], ["city", "City"], ["state", "State"], ["zip", "ZIP"], ["phone", "Phone"], ["email", "Email"],
            ] as Array<[keyof ShippingSettings["shipFrom"], string]>).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input value={form.shipFrom[key]} onChange={(e) => setForm({ ...form, shipFrom: { ...form.shipFrom, [key]: e.target.value } })} data-testid={`input-from-${key}`} />
              </Field>
            ))}
            <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
              <Button onClick={() => save.mutate({ shipFrom: form.shipFrom })} disabled={save.isPending} data-testid="button-save-from">Save address</Button>
            </div>
          </CardContent>
        </Card>

        <TestQuoteCard />
      </div>
    </StaffLayout>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

type BoxDraft = {
  name: string; canCapacity: string; lengthIn: string; widthIn: string; heightIn: string;
  tareWeightOz: string; icePackCount: string; icePackWeightOz: string; packagingFee: string;
};

const draftOf = (b?: ShippingBox): BoxDraft => ({
  name: b?.name ?? "",
  canCapacity: b ? String(b.canCapacity) : "",
  lengthIn: b ? String(b.lengthIn) : "",
  widthIn: b ? String(b.widthIn) : "",
  heightIn: b ? String(b.heightIn) : "",
  tareWeightOz: b ? String(b.tareWeightOz) : "",
  icePackCount: b ? String(b.icePackCount) : "",
  icePackWeightOz: b ? String(b.icePackWeightOz) : "",
  packagingFee: b ? dollars(b.packagingFeeCents) : "",
});

const payloadOf = (d: BoxDraft) => ({
  name: d.name.trim(),
  canCapacity: parseInt(d.canCapacity) || 0,
  lengthIn: parseFloat(d.lengthIn) || 0,
  widthIn: parseFloat(d.widthIn) || 0,
  heightIn: parseFloat(d.heightIn) || 0,
  tareWeightOz: parseFloat(d.tareWeightOz) || 0,
  icePackCount: parseInt(d.icePackCount) || 0,
  icePackWeightOz: parseFloat(d.icePackWeightOz) || 0,
  packagingFeeCents: cents(d.packagingFee),
});

function BoxesCard({ boxes }: { boxes: ShippingBox[] }) {
  const { toast } = useToast();
  const [drafts, setDrafts] = useState<Record<string, BoxDraft>>({});
  const [adding, setAdding] = useState<BoxDraft | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/admin/shipping/settings"] });

  const update = useMutation({
    mutationFn: async ({ id, draft }: { id: string; draft: BoxDraft }) => apiRequest("PATCH", `/api/admin/shipping/boxes/${id}`, payloadOf(draft)),
    onSuccess: (_r, v) => { invalidate(); setDrafts((d) => { const n = { ...d }; delete n[v.id]; return n; }); toast({ title: "Box saved" }); },
    onError: (e: any) => toast({ title: "Couldn't save box", description: e.message, variant: "destructive" }),
  });
  const create = useMutation({
    mutationFn: async (draft: BoxDraft) => apiRequest("POST", "/api/admin/shipping/boxes", payloadOf(draft)),
    onSuccess: () => { invalidate(); setAdding(null); toast({ title: "Box added" }); },
    onError: (e: any) => toast({ title: "Couldn't add box", description: e.message, variant: "destructive" }),
  });
  const retire = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/shipping/boxes/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Box retired" }); },
  });
  const restore = useMutation({
    mutationFn: async (id: string) => apiRequest("PATCH", `/api/admin/shipping/boxes/${id}`, { isActive: true }),
    onSuccess: () => invalidate(),
  });

  const cols: Array<[keyof BoxDraft, string, string]> = [
    ["name", "Name", "w-40"], ["canCapacity", "Cans", "w-16"], ["lengthIn", "L (in)", "w-20"], ["widthIn", "W (in)", "w-20"], ["heightIn", "H (in)", "w-20"],
    ["tareWeightOz", "Tare (oz)", "w-24"], ["icePackCount", "Ice packs", "w-20"], ["icePackWeightOz", "Ice pack (oz)", "w-24"], ["packagingFee", "Packaging fee ($)", "w-28"],
  ];

  const row = (draft: BoxDraft, onChange: (d: BoxDraft) => void, testPrefix: string) =>
    cols.map(([key, , w]) => (
      <td key={key} className="p-1">
        <Input className={`h-8 ${w}`} value={draft[key]} inputMode={key === "name" ? "text" : "decimal"} onChange={(e) => onChange({ ...draft, [key]: e.target.value })} data-testid={`${testPrefix}-${key}`} />
      </td>
    ));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Boxes</CardTitle>
        <CardDescription>
          The insulated shippers an order packs into. Weight = tare + cans + ice packs; the packaging fee covers the box, liner and ice and is charged per box. Weigh a packed sample of each and enter what the scale says.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground">
              {cols.map(([key, label]) => <th key={key} className="text-left font-medium p-1">{label}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {boxes.map((b) => {
              const draft = drafts[b.id] ?? draftOf(b);
              const dirty = !!drafts[b.id];
              return (
                <tr key={b.id} className={b.isActive ? "" : "opacity-50"} data-testid={`row-box-${b.id}`}>
                  {row(draft, (d) => setDrafts({ ...drafts, [b.id]: d }), `input-box-${b.id}`)}
                  <td className="p-1 whitespace-nowrap">
                    {b.isActive ? (
                      <>
                        <Button size="sm" variant={dirty ? "default" : "outline"} className="h-8" disabled={!dirty || update.isPending} onClick={() => update.mutate({ id: b.id, draft })} data-testid={`button-save-box-${b.id}`}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-8 ml-1" title="Retire this box" onClick={() => { if (confirm(`Retire ${b.name}? Orders already quoted with it are unaffected.`)) retire.mutate(b.id); }} data-testid={`button-retire-box-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-8 gap-1" onClick={() => restore.mutate(b.id)} data-testid={`button-restore-box-${b.id}`}><RotateCcw className="h-4 w-4" />Restore</Button>
                    )}
                  </td>
                </tr>
              );
            })}
            {adding && (
              <tr data-testid="row-box-new">
                {row(adding, setAdding, "input-newbox")}
                <td className="p-1 whitespace-nowrap">
                  <Button size="sm" className="h-8" disabled={create.isPending || !adding.name || !adding.canCapacity} onClick={() => create.mutate(adding)} data-testid="button-create-box">Add</Button>
                  <Button size="sm" variant="ghost" className="h-8 ml-1" onClick={() => setAdding(null)}>Cancel</Button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!adding && (
          <Button variant="outline" size="sm" className="mt-3 gap-1" onClick={() => setAdding(draftOf())} data-testid="button-add-box"><Plus className="h-4 w-4" />Add a box</Button>
        )}
      </CardContent>
    </Card>
  );
}

function TestQuoteCard() {
  const [cans, setCans] = useState("24");
  const [subtotal, setSubtotal] = useState("96");
  const [to, setTo] = useState({ name: "Test Customer", address1: "", address2: "", city: "", state: "", zip: "", phone: "" });
  const quote = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/shipping/test-quote", { cans: parseInt(cans) || 0, subtotal: parseFloat(subtotal) || 0, shipTo: to }),
  });
  const q = (quote.data as any)?.quote;
  const tax = (quote.data as any)?.tax;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Try a quote</CardTitle>
        <CardDescription>What a customer at this address would pay for this many cans, with the settings above. Nothing is saved or charged.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Cans"><Input inputMode="numeric" value={cans} onChange={(e) => setCans(e.target.value)} data-testid="input-test-cans" /></Field>
          <Field label="Goods subtotal ($)"><Input inputMode="decimal" value={subtotal} onChange={(e) => setSubtotal(e.target.value)} data-testid="input-test-subtotal" /></Field>
          <Field label="Street"><Input value={to.address1} onChange={(e) => setTo({ ...to, address1: e.target.value })} data-testid="input-test-address1" /></Field>
          <Field label="City"><Input value={to.city} onChange={(e) => setTo({ ...to, city: e.target.value })} data-testid="input-test-city" /></Field>
          <Field label="State"><Input value={to.state} onChange={(e) => setTo({ ...to, state: e.target.value })} data-testid="input-test-state" /></Field>
          <Field label="ZIP"><Input value={to.zip} onChange={(e) => setTo({ ...to, zip: e.target.value })} data-testid="input-test-zip" /></Field>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={() => quote.mutate()} disabled={quote.isPending} data-testid="button-test-quote">{quote.isPending ? "Quoting…" : "Get quote"}</Button>
          {quote.isError && <span className="text-sm text-destructive" data-testid="text-test-quote-error">{(quote.error as any)?.message}</span>}
        </div>
        {q && (
          <div className="rounded-md border p-4 text-sm space-y-2" data-testid="text-test-quote-result">
            <div className="font-semibold">Shipping &amp; handling: ${dollars(q.totalCents)}{q.stub ? " (test rate)" : ""}</div>
            <div className="text-muted-foreground">Carrier ${dollars(q.carrierCents)} + packaging ${dollars(q.packagingCents)} · ships {formatShipDate(q.shipDate)}{q.estimatedDays != null ? ` · ${q.estimatedDays}-day transit` : ""}</div>
            <ul className="list-disc pl-5">
              {q.boxes.map((b: any, i: number) => (
                <li key={i}>{b.boxName}: {b.cans} cans, {b.weightOz} oz · {b.carrier} {b.service} ${dollars(b.carrierCents)} + ${dollars(b.packagingCents)} packaging</li>
              ))}
            </ul>
            {tax && <div className="text-muted-foreground">Sales tax on goods + shipping: ${dollars(tax.taxCents)} ({tax.source === "stripe_tax" ? "Stripe Tax" : "WA flat fallback"})</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
