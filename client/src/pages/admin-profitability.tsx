import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  CHANNELS,
  CHANNEL_LABELS,
  CO2_LB_PER_GALLON_PER_VOLUME,
  GALLONS_PER_CASE,
  GALLONS_PER_KEG,
  LABOR_BUCKETS,
  LABOR_LABELS,
  WEEKS_PER_YEAR,
  defaultInputs,
  normalizeInputs,
  projectWeek,
  withActualSales,
  type CatalogPrices,
  type Channel,
  type ChannelInputs,
  type LaborBucket,
  type ProjectionActuals,
  type ProjectionBasis,
  type ProjectionInputs,
} from "@shared/profitability";

/**
 * Weekly profitability projection (owner, 2026-11-15), admin and super admin.
 * Sales by channel in, costs from the recipes, labor and overhead as the owner
 * enters them, and the week's profit out, with break-even and a 52-week view.
 * Named scenarios save on the server so "this winter" can sit beside "today".
 */

type BasisResponse = { basis: ProjectionBasis; actuals: ProjectionActuals; catalog: CatalogPrices };
type Scenario = { id: string; name: string; inputs: ProjectionInputs; updatedAt: string };
type Draft = { inputs: ProjectionInputs; scenarioId: string | null; name: string; updatedAt: string };

const money0 = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })}`;
const money2 = (n: number) =>
  `${n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
const num = (n: number, digits = 1) => n.toLocaleString("en-US", { maximumFractionDigits: digits });

/**
 * A number box that lets you clear it and type: it keeps its own text while
 * you edit and reports a number, and takes a new value from outside (a loaded
 * scenario, a prefill) when that value isn't what it already shows.
 */
function NumberField({
  value, onChange, step = "any", min = 0, prefix, suffix, className, testId, ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: string;
  min?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
  testId?: string;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    const shown = parseFloat(text);
    const same = (Number.isFinite(shown) ? shown : 0) === value;
    if (!same) setText(String(value));
    // Only an outside change to `value` should reset the text; keystrokes report through onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={`relative ${className ?? ""}`}>
      {prefix && <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{prefix}</span>}
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={text}
        aria-label={ariaLabel}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          onChange(Number.isFinite(n) && n >= min ? n : 0);
        }}
        className={`h-8 text-right tabular-nums ${prefix ? "pl-6" : ""} ${suffix ? "pr-8" : ""}`}
        data-testid={testId}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Stat({ label, value, hint, tone, testId }: { label: string; value: string; hint?: string; tone?: "good" | "bad"; testId?: string }) {
  const color = tone === "good" ? "text-green-700 dark:text-green-400" : tone === "bad" ? "text-destructive" : "";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${color}`} data-testid={testId}>{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

export default function AdminProfitability() {
  const { toast } = useToast();
  const { data: basisData, isLoading: basisLoading, error: basisError } = useQuery<BasisResponse>({ queryKey: ["/api/profitability/basis"] });
  const { data: scenarios, isLoading: scenariosLoading } = useQuery<Scenario[]>({ queryKey: ["/api/profitability/scenarios"] });
  const { data: draftData, isLoading: draftLoading } = useQuery<{ draft: Draft | null }>({ queryKey: ["/api/profitability/draft"] });

  const [inputs, setInputs] = useState<ProjectionInputs | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Which scenario the editor shows right now, for a save's answer to check against.
  const editingRef = useRef<string | null>(null);
  editingRef.current = scenarioId;

  const loadScenario = (s: Scenario) => {
    setScenarioId(s.id);
    setName(s.name);
    setInputs(normalizeInputs(s.inputs));
  };

  // First load: where this admin left off, else the most recently saved scenario,
  // else a fresh projection from recent sales.
  useEffect(() => {
    if (inputs || !basisData || !scenarios || draftData === undefined) return;
    const draft = draftData?.draft;
    if (draft) {
      const stillThere = draft.scenarioId ? scenarios.find((s) => s.id === draft.scenarioId) : undefined;
      setScenarioId(stillThere?.id ?? null);
      setName(draft.name || stillThere?.name || "This week");
      setInputs(normalizeInputs(draft.inputs, defaultInputs(basisData.actuals, basisData.catalog)));
      return;
    }
    const latest = [...scenarios].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) loadScenario(latest);
    else {
      setInputs(defaultInputs(basisData.actuals, basisData.catalog));
      setName("This week");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basisData, scenarios, draftData, inputs]);

  // Kept as typed, a moment after the last change, so leaving the page loses
  // nothing. The first value after loading is what was just loaded, not a change.
  const draftLoaded = useRef(false);
  useEffect(() => {
    if (!inputs) return;
    if (!draftLoaded.current) {
      draftLoaded.current = true;
      return;
    }
    const handle = setTimeout(() => {
      apiRequest("PUT", "/api/profitability/draft", { inputs, scenarioId, name }).catch((e: any) =>
        console.warn("[profitability] couldn't keep the inputs:", e?.message),
      );
    }, 800);
    return () => clearTimeout(handle);
  }, [inputs, scenarioId, name]);

  const projection = useMemo(() => (inputs && basisData ? projectWeek(inputs, basisData.basis) : null), [inputs, basisData]);

  const savedScenario = scenarios?.find((s) => s.id === scenarioId) ?? null;
  const dirty = !!inputs && (!savedScenario || savedScenario.name !== name || JSON.stringify(normalizeInputs(savedScenario.inputs)) !== JSON.stringify(inputs));

  // The name in the box decides what Save does (owner, 2026-11-15: "Saved a few
  // scenarios but only see the current one" — each save under a new name had
  // renamed the one on screen). A name no scenario has makes a new scenario; a
  // name already in the list saves over that scenario, on screen or not; and the
  // button says which before it is pressed. Renaming is its own, smaller button.
  const trimmedName = name.trim();
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const target = trimmedName ? (scenarios ?? []).find((s) => sameName(s.name, trimmedName)) ?? null : null;
  const saveLabel = !target
    ? scenarioId ? "Save as new scenario" : "Save scenario"
    : target.id === scenarioId ? "Save changes" : `Save over “${target.name}”`;
  const canRename = !!savedScenario && !!trimmedName && !sameName(savedScenario.name, trimmedName) && !target;

  const save = useMutation({
    mutationFn: async (mode: "save" | "rename") => {
      const startedOn = scenarioId;
      const body =
        mode === "rename" && savedScenario
          ? // The name only: the scenario keeps the numbers it was saved with.
            { id: savedScenario.id, name: trimmedName, inputs: normalizeInputs(savedScenario.inputs) }
          : { id: target?.id, name: trimmedName || "Untitled", inputs };
      const saved = (await apiRequest("POST", "/api/profitability/scenarios", body)) as Scenario;
      return { saved, startedOn, mode, created: !body.id };
    },
    onSuccess: ({ saved, startedOn, mode, created }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/scenarios"] });
      // The answer re-points the editor only if it is still on the scenario the save
      // started from; a switch made meanwhile keeps what was switched to (review,
      // 2026-11-15). The picker is also disabled while a save is in flight.
      if (editingRef.current === startedOn) {
        setScenarioId(saved.id);
        setName(saved.name);
      }
      toast({
        title: mode === "rename" ? "Scenario renamed" : created ? "Saved as a new scenario" : "Scenario saved",
        description: saved.name,
      });
    },
    onError: (e: any) => {
      // The list may be behind (another admin saved): show the names as they are now.
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/scenarios"] });
      toast({ title: "Couldn't save", description: apiErrorMessage(e, "Couldn't save the scenario"), variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/profitability/scenarios/${id}`),
    onSuccess: (_data, id) => {
      const remaining = (scenarios ?? []).filter((s) => s.id !== id);
      queryClient.invalidateQueries({ queryKey: ["/api/profitability/scenarios"] });
      if (remaining[0]) loadScenario(remaining[0]);
      else {
        setScenarioId(null);
        setName("This week");
        if (basisData) setInputs(defaultInputs(basisData.actuals, basisData.catalog));
      }
      toast({ title: "Scenario deleted" });
    },
    onError: (e: any) => toast({ title: "Couldn't delete", description: e.message, variant: "destructive" }),
  });
  const busy = save.isPending || remove.isPending;

  const set = <K extends keyof ProjectionInputs>(key: K, value: ProjectionInputs[K]) =>
    setInputs((i) => (i ? { ...i, [key]: value } : i));
  const setChannel = (ch: Channel, field: keyof ChannelInputs, value: number) =>
    setInputs((i) => (i ? { ...i, channels: { ...i.channels, [ch]: { ...i.channels[ch], [field]: value } } } : i));
  const setLabor = (b: LaborBucket, field: "hoursPerWeek" | "ratePerHour", value: number) =>
    setInputs((i) => (i ? { ...i, labor: { ...i.labor, [b]: { ...i.labor[b], [field]: value } } } : i));

  if (basisLoading || scenariosLoading || draftLoading || (!inputs && !basisError)) {
    return (
      <StaffLayout>
        <div className="flex items-center justify-center min-h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </StaffLayout>
    );
  }

  if (!basisData || !inputs || !projection) {
    return (
      <StaffLayout>
        <div className="max-w-3xl mx-auto px-6 py-12 text-muted-foreground">
          Couldn't price the recipes{basisError ? `: ${(basisError as Error).message}` : ""}.
        </div>
      </StaffLayout>
    );
  }

  const { basis, actuals, catalog } = basisData;
  const u = projection.unitCosts;
  const operatingCosts = projection.fees + projection.exciseTax + projection.insurance + projection.weeklyFixedCosts;
  const actualLine = (ch: Channel) => {
    const a = actuals.channels[ch];
    const parts: string[] = [];
    if (a.casesPerWeek > 0) parts.push(`${num(a.casesPerWeek)} cases at ${a.casePrice !== null ? money2(a.casePrice) : "—"}`);
    if (a.kegsPerWeek > 0) parts.push(`${num(a.kegsPerWeek)} kegs at ${a.kegPrice !== null ? money2(a.kegPrice) : "—"}`);
    return parts.length ? parts.join(", ") : "nothing";
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" data-testid="text-profitability-title">Weekly Profitability</h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              A projected week. Sales by channel go in; ingredient and packaging costs come from the recipes;
              labor, overhead and taxes are yours to set. Every number updates as you type, and what you type is
              kept for you between visits. Save keeps it under the name in the box: a new name makes a new
              scenario, a name already in the list saves over that one.
            </p>
          </div>
          {dirty && (
            <Badge variant="outline" data-testid="badge-unsaved">
              {scenarioId ? "Differs from the saved scenario" : "Not saved as a scenario yet"}
            </Badge>
          )}
        </div>

        {/* Scenarios */}
        <Card className="mb-6">
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Saved scenario</Label>
              <Select
                value={scenarioId ?? "__new__"}
                disabled={busy}
                onValueChange={(v) => {
                  if (v === "__new__") {
                    setScenarioId(null);
                    setName("New scenario");
                    setInputs(defaultInputs(actuals, catalog));
                    return;
                  }
                  const s = scenarios?.find((x) => x.id === v);
                  if (s) loadScenario(s);
                }}
              >
                <SelectTrigger className="w-56 h-9" data-testid="select-scenario"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(scenarios ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  <SelectItem value="__new__">New from recent sales…</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="w-56 h-9" maxLength={60} data-testid="input-scenario-name" />
            </div>
            <Button onClick={() => save.mutate("save")} disabled={busy} data-testid="button-save-scenario">
              {save.isPending && save.variables === "save" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {saveLabel}
            </Button>
            {canRename && savedScenario && (
              <Button variant="outline" onClick={() => save.mutate("rename")} disabled={busy} data-testid="button-rename-scenario">
                {save.isPending && save.variables === "rename" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Pencil className="w-4 h-4 mr-2" />}
                Rename “{savedScenario.name}” instead
              </Button>
            )}
            {scenarioId && (
              <Button variant="ghost" onClick={() => remove.mutate(scenarioId)} disabled={busy} data-testid="button-delete-scenario">
                <Trash2 className="w-4 h-4 mr-2" />Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setInputs(withActualSales(inputs, actuals, catalog))} data-testid="button-use-actuals">
              <History className="w-4 h-4 mr-2" />Use the last {actuals.weeks} weeks' sales
            </Button>
          </CardContent>
        </Card>

        {/* The week at a glance */}
        <div className="grid gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6 mb-6">
          <Stat label="Revenue" value={money0(projection.revenue)} hint="per week" testId="stat-revenue" />
          <Stat label="Cost of goods" value={money0(projection.cogs)} hint={projection.revenue > 0 ? `${pct(projection.cogs / projection.revenue)} of revenue` : undefined} testId="stat-cogs" />
          <Stat label="Gross margin" value={money0(projection.grossMargin)} hint={projection.revenue > 0 ? pct(projection.grossMargin / projection.revenue) : undefined} testId="stat-gross" />
          <Stat label="Operating costs" value={money0(operatingCosts)} hint="fees, B&O, insurance, labor, overhead" testId="stat-opex" />
          <Stat label="Operating profit" value={money0(projection.operatingProfit)} tone={projection.operatingProfit >= 0 ? "good" : "bad"} hint="before your pay" testId="stat-operating" />
          <Stat label="After your pay" value={money0(projection.netProfit)} tone={projection.netProfit >= 0 ? "good" : "bad"} hint={`${money0(projection.annual.netProfit)} a year`} testId="stat-net" />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Inputs */}
          <div className="lg:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Sales per week</CardTitle>
                <CardDescription>Cases are cans. Prices before sales tax and deposits. Fees are what the payment processor keeps.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Channel</TableHead>
                      <TableHead className="text-right">Cases / wk</TableHead>
                      <TableHead className="text-right">Per case</TableHead>
                      <TableHead className="text-right">Kegs / wk</TableHead>
                      <TableHead className="text-right">Per keg</TableHead>
                      <TableHead className="text-right">Fees</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {CHANNELS.map((ch) => (
                      <TableRow key={ch} data-testid={`row-sales-${ch}`}>
                        <TableCell className="font-medium">
                          {CHANNEL_LABELS[ch]}
                          <div className="text-[11px] font-normal text-muted-foreground">Last {actuals.weeks} wks: {actualLine(ch)}</div>
                        </TableCell>
                        <TableCell><NumberField className="w-24 ml-auto" value={inputs.channels[ch].casesPerWeek} onChange={(v) => setChannel(ch, "casesPerWeek", v)} ariaLabel={`${CHANNEL_LABELS[ch]} cases per week`} testId={`input-${ch}-cases`} /></TableCell>
                        <TableCell><NumberField className="w-24 ml-auto" prefix="$" step="0.01" value={inputs.channels[ch].casePrice} onChange={(v) => setChannel(ch, "casePrice", v)} ariaLabel={`${CHANNEL_LABELS[ch]} price per case`} testId={`input-${ch}-case-price`} /></TableCell>
                        <TableCell><NumberField className="w-20 ml-auto" value={inputs.channels[ch].kegsPerWeek} onChange={(v) => setChannel(ch, "kegsPerWeek", v)} ariaLabel={`${CHANNEL_LABELS[ch]} kegs per week`} testId={`input-${ch}-kegs`} /></TableCell>
                        <TableCell><NumberField className="w-24 ml-auto" prefix="$" step="0.01" value={inputs.channels[ch].kegPrice} onChange={(v) => setChannel(ch, "kegPrice", v)} ariaLabel={`${CHANNEL_LABELS[ch]} price per keg`} testId={`input-${ch}-keg-price`} /></TableCell>
                        <TableCell><NumberField className="w-20 ml-auto" suffix="%" step="0.1" value={inputs.channels[ch].feePercent} onChange={(v) => setChannel(ch, "feePercent", v)} ariaLabel={`${CHANNEL_LABELS[ch]} processing fee percent`} testId={`input-${ch}-fee`} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">What the product costs</CardTitle>
                <CardDescription>
                  From the recipes: each flavor's Brew recipe prices a gallon, its Can recipe prices a case's packaging.
                  A keg is {num(u.liquidGallonsPerKeg, 2)} gallons of kombucha and its CO2, nothing else.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Liquid waste" hint="Lost between brew and package">
                    <NumberField suffix="%" step="0.5" value={inputs.liquidWastePercent} onChange={(v) => set("liquidWastePercent", v)} testId="input-liquid-waste" />
                  </Field>
                  <Field label="Packaging waste" hint="Spoiled cans, ends, boxes, stickers">
                    <NumberField suffix="%" step="0.5" value={inputs.packagingWastePercent} onChange={(v) => set("packagingWastePercent", v)} testId="input-packaging-waste" />
                  </Field>
                  <Field label="Flavor mix" hint="How flavors are weighted">
                    <Select value={inputs.flavorMix} onValueChange={(v) => set("flavorMix", v as ProjectionInputs["flavorMix"])}>
                      <SelectTrigger className="h-8" data-testid="select-flavor-mix"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sales">Recent sales mix</SelectItem>
                        <SelectItem value="even">Every flavor evenly</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="CO2, price per lb" hint="From your cylinder or bulk invoices">
                    <NumberField prefix="$" step="0.01" value={inputs.co2PricePerLb} onChange={(v) => set("co2PricePerLb", v)} testId="input-co2-price" />
                  </Field>
                  <Field label="Carbonation, volumes" hint={`${num(inputs.co2Volumes * CO2_LB_PER_GALLON_PER_VOLUME, 4)} lb dissolved per gallon`}>
                    <NumberField step="0.1" value={inputs.co2Volumes} onChange={(v) => set("co2Volumes", v)} testId="input-co2-volumes" />
                  </Field>
                  <Field label="CO2 waste" hint="Gas left in the tank after the push, purges, the canning line, leaks">
                    <NumberField suffix="%" step="5" value={inputs.co2WastePercent} onChange={(v) => set("co2WastePercent", v)} testId="input-co2-waste" />
                  </Field>
                </div>
                <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 text-sm">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Ingredients per gallon</dt><dd className="tabular-nums" data-testid="text-ingredient-per-gallon">{money2(u.ingredientPerGallon)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Packaging per case, with waste</dt><dd className="tabular-nums">{money2(u.packagingPerCase)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Kombucha per case, with waste</dt><dd className="tabular-nums">{num(u.liquidGallonsPerCase, 3)} gal</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Kombucha per keg, with waste</dt><dd className="tabular-nums">{num(u.liquidGallonsPerKeg, 3)} gal</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">CO2 per case, with waste</dt><dd className="tabular-nums" data-testid="text-co2-case">{num(GALLONS_PER_CASE * u.co2LbPerGallon, 3)} lb, {money2(u.caseCo2)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">CO2 per keg, with waste</dt><dd className="tabular-nums" data-testid="text-co2-keg">{num(GALLONS_PER_KEG * u.co2LbPerGallon, 2)} lb, {money2(u.kegCo2)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Cost per case</dt><dd className="tabular-nums" data-testid="text-case-cost">{money2(u.caseCost)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>Cost per keg</dt><dd className="tabular-nums" data-testid="text-keg-cost">{money2(u.kegCost)}</dd></div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Labor</CardTitle>
                <CardDescription>Hours a week by what they're spent on. Burden is employer payroll tax and the like, on top of wages.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Work</TableHead>
                      <TableHead className="text-right">Hours / wk</TableHead>
                      <TableHead className="text-right">Per hour</TableHead>
                      <TableHead className="text-right">Weekly</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {LABOR_BUCKETS.map((b) => (
                      <TableRow key={b}>
                        <TableCell className="font-medium">{LABOR_LABELS[b]}</TableCell>
                        <TableCell><NumberField className="w-20 ml-auto" step="0.5" value={inputs.labor[b].hoursPerWeek} onChange={(v) => setLabor(b, "hoursPerWeek", v)} ariaLabel={`${LABOR_LABELS[b]} hours per week`} testId={`input-labor-${b}-hours`} /></TableCell>
                        <TableCell><NumberField className="w-24 ml-auto" prefix="$" step="0.25" value={inputs.labor[b].ratePerHour} onChange={(v) => setLabor(b, "ratePerHour", v)} ariaLabel={`${LABOR_LABELS[b]} rate per hour`} testId={`input-labor-${b}-rate`} /></TableCell>
                        <TableCell className="text-right tabular-nums">{money0(projection.labor.buckets[b])}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow>
                      <TableCell className="font-medium" colSpan={3}>
                        All labor, with burden
                        <div className="text-[11px] font-normal text-muted-foreground" data-testid="text-labor-split">
                          {money0(projection.labor.wages)} in wages plus {money0(projection.labor.burden)} burden
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium" data-testid="text-labor-total">{money0(projection.labor.total)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Payroll burden" hint={`Employer taxes on the hours above: ${money0(projection.labor.burden)} a week`}>
                    <NumberField suffix="%" step="0.5" value={inputs.payrollBurdenPercent} onChange={(v) => set("payrollBurdenPercent", v)} testId="input-payroll-burden" />
                  </Field>
                  <Field label="Your own pay, per week" hint="Kept apart so profit shows before and after it">
                    <NumberField prefix="$" step="1" value={inputs.ownerPayPerWeek} onChange={(v) => set("ownerPayPerWeek", v)} testId="input-owner-pay" />
                  </Field>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Overhead</CardTitle>
                <CardDescription>Monthly and yearly figures are spread over {WEEKS_PER_YEAR} weeks. Together these come to {money0(projection.overhead.total)} a week, with insurance on top as a share of sales.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Rent, per month"><NumberField prefix="$" step="1" value={inputs.rentPerMonth} onChange={(v) => set("rentPerMonth", v)} testId="input-rent" /></Field>
                <Field label="Insurance, % of sales" hint={`${money0(projection.insurance)} on this week's sales`}><NumberField suffix="%" step="0.1" value={inputs.insurancePercent} onChange={(v) => set("insurancePercent", v)} testId="input-insurance" /></Field>
                <Field label="Keg replacement, per year" hint="Kegs lost or never returned"><NumberField prefix="$" step="1" value={inputs.kegReplacementPerYear} onChange={(v) => set("kegReplacementPerYear", v)} testId="input-keg-replacement" /></Field>
                <Field label="Vehicle miles, per week"><NumberField step="1" value={inputs.vehicleMilesPerWeek} onChange={(v) => set("vehicleMilesPerWeek", v)} testId="input-miles" /></Field>
                <Field label="Rate per mile"><NumberField prefix="$" step="0.01" value={inputs.ratePerMile} onChange={(v) => set("ratePerMile", v)} testId="input-rate-per-mile" /></Field>
                <Field label="Your travel, per week" hint="Beyond the vehicle miles"><NumberField prefix="$" step="1" value={inputs.ownerTravelPerWeek} onChange={(v) => set("ownerTravelPerWeek", v)} testId="input-owner-travel" /></Field>
                <Field label="Other overhead, per week" hint="Utilities, CO2 and sanitizer, software, licenses, repairs, loan payments"><NumberField prefix="$" step="1" value={inputs.otherOverheadPerWeek} onChange={(v) => set("otherOverheadPerWeek", v)} testId="input-other-overhead" /></Field>
                <Field label="B&O excise tax" hint="Of sales. 0.484% wholesaling, 0.471% retailing"><NumberField suffix="%" step="0.001" value={inputs.exciseTaxPercent} onChange={(v) => set("exciseTaxPercent", v)} testId="input-excise" /></Field>
                <Field label="Free product, cases per week" hint={`Samples and dumps, at ${money2(u.caseCost)} a case`}><NumberField step="0.5" value={inputs.freeCasesPerWeek} onChange={(v) => set("freeCasesPerWeek", v)} testId="input-free-cases" /></Field>
              </CardContent>
            </Card>
          </div>

          {/* Results */}
          <div className="space-y-6 lg:sticky lg:top-6 self-start">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Margin by channel</CardTitle>
                <CardDescription>Per unit, after cost of goods, fees, B&O and insurance.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead className="text-right">Margin</TableHead>
                      <TableHead className="text-right">Weekly</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projection.channels.flatMap((c) => {
                      const rows = [] as React.ReactNode[];
                      if (c.cases > 0 || c.perCase.price > 0) {
                        rows.push(
                          <TableRow key={`${c.channel}-case`} data-testid={`row-margin-${c.channel}-case`}>
                            <TableCell className="text-sm">{CHANNEL_LABELS[c.channel]} case</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{money2(c.perCase.price)}</TableCell>
                            <TableCell className={`text-right tabular-nums text-sm ${c.perCase.margin < 0 ? "text-destructive" : ""}`}>{money2(c.perCase.margin)} <span className="text-muted-foreground">({pct(c.perCase.marginPercent, 0)})</span></TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{money0(c.cases * c.perCase.margin)}</TableCell>
                          </TableRow>,
                        );
                      }
                      if (c.kegs > 0 || c.perKeg.price > 0) {
                        rows.push(
                          <TableRow key={`${c.channel}-keg`} data-testid={`row-margin-${c.channel}-keg`}>
                            <TableCell className="text-sm">{CHANNEL_LABELS[c.channel]} keg</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{money2(c.perKeg.price)}</TableCell>
                            <TableCell className={`text-right tabular-nums text-sm ${c.perKeg.margin < 0 ? "text-destructive" : ""}`}>{money2(c.perKeg.margin)} <span className="text-muted-foreground">({pct(c.perKeg.marginPercent, 0)})</span></TableCell>
                            <TableCell className="text-right tabular-nums text-sm">{money0(c.kegs * c.perKeg.margin)}</TableCell>
                          </TableRow>,
                        );
                      }
                      return rows;
                    })}
                    <TableRow>
                      <TableCell className="font-medium" colSpan={3}>Left to cover labor and overhead</TableCell>
                      <TableCell className="text-right tabular-nums font-medium" data-testid="text-contribution">{money0(projection.contribution)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Where the week goes</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-1 text-sm">
                  {[
                    ["Revenue", projection.revenue],
                    ["Cost of goods", -projection.cogs],
                    ["Processing fees", -projection.fees],
                    ["B&O tax", -projection.exciseTax],
                    ["Insurance", -projection.insurance],
                    ["Labor", -projection.labor.total],
                    ["Rent", -projection.overhead.rent],
                    ["Vehicle and travel", -(projection.overhead.vehicle + projection.overhead.ownerTravel)],
                    ["Keg replacement", -projection.overhead.kegReplacement],
                    ["Other overhead", -projection.overhead.other],
                    ["Free product", -projection.overhead.freeProduct],
                  ].map(([label, value]) => (
                    <div key={label as string} className="flex justify-between">
                      <dt className="text-muted-foreground">{label as string}</dt>
                      <dd className="tabular-nums">{money0(value as number)}</dd>
                    </div>
                  ))}
                  <Separator className="my-2" />
                  <div className="flex justify-between font-medium">
                    <dt>Operating profit</dt>
                    <dd className={`tabular-nums ${projection.operatingProfit < 0 ? "text-destructive" : ""}`}>{money0(projection.operatingProfit)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Your pay</dt>
                    <dd className="tabular-nums">{money0(-projection.ownerPay)}</dd>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <dt>Profit after your pay</dt>
                    <dd className={`tabular-nums ${projection.netProfit < 0 ? "text-destructive" : "text-green-700 dark:text-green-400"}`}>{money0(projection.netProfit)}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Break-even</CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {projection.breakEven.scale === null ? (
                  <p className="text-muted-foreground">Sales don't cover their own cost of goods and fees at these prices, so no volume breaks even.</p>
                ) : projection.breakEven.scale === 0 ? (
                  <p className="text-muted-foreground" data-testid="text-break-even">
                    With no labor, overhead or pay entered yet, every sale is profit. Fill those in for a real break-even.
                  </p>
                ) : (
                  <>
                    <p data-testid="text-break-even">
                      You break even, after your pay, at <span className="font-semibold">{pct(projection.breakEven.scale, 0)}</span> of these volumes.
                      {projection.breakEven.scale <= 1
                        ? ` The other ${pct(1 - projection.breakEven.scale, 0)} is profit.`
                        : " You'd need more sales than this at the same mix."}
                    </p>
                    <ul className="text-muted-foreground space-y-0.5">
                      {CHANNELS.map((ch) => {
                        const be = projection.breakEven.channels![ch];
                        if (be.cases === 0 && be.kegs === 0) return null;
                        return (
                          <li key={ch}>
                            {CHANNEL_LABELS[ch]}: {be.cases > 0 ? `${num(be.cases, 0)} cases` : ""}{be.cases > 0 && be.kegs > 0 ? " and " : ""}{be.kegs > 0 ? `${num(be.kegs)} kegs` : ""} a week
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <Separator className="my-2" />
                <p className="text-muted-foreground">
                  Over {WEEKS_PER_YEAR} weeks: {money0(projection.annual.revenue)} in sales,{" "}
                  <span className={projection.annual.netProfit < 0 ? "text-destructive" : ""}>{money0(projection.annual.netProfit)}</span> after your pay.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Flavors as the recipes price them</CardTitle>
                <CardDescription>Mix is the share of kombucha sold in the last {actuals.weeks} weeks.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Flavor</TableHead>
                      <TableHead className="text-right">Per gal</TableHead>
                      <TableHead className="text-right">Pkg / case</TableHead>
                      <TableHead className="text-right">Mix</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {basis.flavors.map((f) => (
                      <TableRow key={f.flavorId} data-testid={`row-flavor-${f.flavorId}`}>
                        <TableCell className="text-sm">{f.name}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{f.ingredientPerGallon === null ? "—" : money2(f.ingredientPerGallon)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{f.packagingPerCase === null ? "—" : money2(f.packagingPerCase)}</TableCell>
                        <TableCell className="text-right tabular-nums text-sm">{pct(f.salesWeight, 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {basis.notes.length > 0 && (
                  <ul className="px-6 py-3 text-xs text-muted-foreground space-y-0.5">
                    {basis.notes.map((n) => <li key={n}>{n}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </StaffLayout>
  );
}
