/**
 * The tank map (owner, 2026-11-16): "a visual map of my 4 fermenters (three 7 bbl, one
 * 10 bbl), brite tanks (three 10 bbl) and fridge (storage for 1/2 barrel kegs for smaller
 * batches), so I know what's in them at any time and can plan brewing and know what's
 * available to package. The fermenters are in the middle in a square. The brites are to
 * the left in an L. The fridge is to the right. We'll need to record the dates those
 * went in and flavor (with color coding)."
 *
 * Every vessel is drawn where it stands, filled to its level in its flavor's color (the
 * accents the big names wear on Our Kombucha, FLAVOR_ACCENTS), with the date it went in
 * and how long ago that was. Tapping one records a fill, a move to the next vessel,
 * what was packaged or dumped, or kegs out of the fridge. Staff and admins; the server
 * side is server/tank-map.ts, the shapes shared/tank-map.ts.
 */
import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowRightLeft, Loader2, PackageOpen, Pencil, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage, apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { FLAVOR_ACCENTS } from "@/lib/flavor-display";
import { PICKUP_POLICY } from "@shared/pickup-policy";
import {
  BBL_PER_HALF_BBL_KEG,
  FILL_OUTCOME_LABELS,
  VESSEL_KIND_LABELS,
  VESSEL_SHAPES,
  VESSEL_SHAPE_LABELS,
  defaultVesselShape,
  packagesFromBbl,
  type FillOutcome,
  type TankMapData,
  type TankMapFill,
  type TankMapVessel,
  type VesselKind,
  type VesselShape,
} from "@shared/tank-map";

const TZ = PICKUP_POLICY.timezone;
const QUERY_KEY = ["/api/tank-map"];

const dateWord = (iso: string) => formatInTimeZone(new Date(iso), TZ, "MMM d");
/** Calendar days in the brewery's time zone: something that went in yesterday afternoon has been in a day. */
const dayNumber = (d: Date) => {
  const [y, m, day] = formatInTimeZone(d, TZ, "yyyy-MM-dd").split("-").map(Number);
  return Date.UTC(y, m - 1, day) / 86_400_000;
};
const daysSince = (iso: string) => Math.max(0, dayNumber(new Date()) - dayNumber(new Date(iso)));
const dayWord = (n: number) => (n === 0 ? "today" : `${n} ${n === 1 ? "day" : "days"}`);
const bbl = (n: number) => `${Number.isInteger(n) ? n : Number(n.toFixed(1))} bbl`;
const kegWord = (n: number) => `${n} ${n === 1 ? "keg" : "kegs"}`;
const round = (n: number) => Math.round(n);
const todayInput = () => formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
const inputDate = (iso: string | null) => (iso ? formatInTimeZone(new Date(iso), TZ, "yyyy-MM-dd") : "");
/** A date typed on the tablet, as midday that day: the staff's calendar day, whatever the clock says. */
const fromInput = (d: string) => (d ? new Date(`${d}T12:00:00`).toISOString() : undefined);

const FALLBACK_ACCENTS = Object.values(FLAVOR_ACCENTS);
/** The flavor's accent from Our Kombucha; a flavor without one gets a steady pick from the same set. */
function accentFor(name: string): string {
  if (FLAVOR_ACCENTS[name]) return FLAVOR_ACCENTS[name];
  const hash = Array.from(name).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return FALLBACK_ACCENTS[hash % FALLBACK_ACCENTS.length];
}

/** The amount in a fill, in words: barrels in a tank, kegs in the fridge. */
const amountWord = (f: TankMapFill) => (f.kegs !== null ? kegWord(f.kegs) : f.volumeBbl !== null ? bbl(f.volumeBbl) : "");
/** The amount as it went in, before any part moved on or left. */
const amountInWord = (f: TankMapFill) => (f.kegsIn !== null ? kegWord(f.kegsIn) : f.volumeBblIn !== null ? bbl(f.volumeBblIn) : amountWord(f));
/** What a tank's contents would package into. */
function packagesWord(volumeBbl: number) {
  const p = packagesFromBbl(volumeBbl);
  return `≈ ${round(p.cases)} cases or ${round(p.halfBarrels)} half-barrels`;
}

/** Each shape as drawn: where the liquid sits, the vessel's outline, the hardware behind it and over it. */
const SHAPES: Record<VesselShape, { top: number; bottom: number; body: string; behind?: string; over?: string }> = {
  // A cylinder on a cone, standing on legs.
  conical: {
    top: 10,
    bottom: 130,
    body: "M22 26 Q22 10 50 10 Q78 10 78 26 L78 92 L50 130 L22 92 Z",
    behind: "M30 102 L18 136 M70 102 L82 136",
  },
  // An open pot: a rim, two handles, a flat bottom.
  pot: {
    top: 30,
    bottom: 126,
    body: "M20 24 L80 24 L80 118 Q80 126 72 126 L28 126 Q20 126 20 118 Z",
    behind: "M20 42 Q6 42 6 52 Q6 62 20 62 M80 42 Q94 42 94 52 Q94 62 80 62",
    over: "M15 24 L85 24",
  },
  // An IBC tote: the square tank in its cage, on a pallet, a cap on top and the valve below.
  tote: {
    top: 22,
    bottom: 118,
    body: "M18 22 H82 Q86 22 86 26 V114 Q86 118 82 118 H18 Q14 118 14 114 V26 Q14 22 18 22 Z",
    behind: "M42 22 V12 H58 V22 M46 118 V124 H54 V118 M10 124 H90 M10 134 H90 M14 124 V134 M50 124 V134 M86 124 V134",
    over: "M32 22 V118 M50 22 V118 M68 22 V118 M14 46 H86 M14 70 H86 M14 94 H86",
  },
};
const SHAPE_WORDS: Record<VesselShape, string> = { conical: "conical", pot: "pot", tote: "IBC tote" };

/** The silhouette of a vessel, filled to its level. */
function TankFigure({ shape, ratio, color }: { shape: VesselShape; ratio: number; color: string | null }) {
  const clipId = useId();
  const s = SHAPES[shape];
  const level = Math.max(0, Math.min(1, ratio));
  const y = s.bottom - (s.bottom - s.top) * level;
  return (
    <svg viewBox="0 0 100 140" className="h-28 w-auto text-foreground" aria-hidden="true">
      <defs>
        <clipPath id={clipId}>
          <path d={s.body} />
        </clipPath>
      </defs>
      {s.behind && <path d={s.behind} stroke="currentColor" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />}
      <path d={s.body} fill="currentColor" fillOpacity="0.06" />
      {color && level > 0 && (
        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y={y} width="100" height={s.bottom - y + 2} fill={color} fillOpacity="0.85" />
          <rect x="0" y={y} width="100" height="3" fill="#ffffff" fillOpacity="0.35" />
        </g>
      )}
      {s.over && <path d={s.over} stroke="currentColor" strokeOpacity="0.3" strokeWidth="2" strokeLinecap="round" fill="none" />}
      <path d={s.body} fill="none" stroke="currentColor" strokeOpacity="0.5" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function TankCard({ vessel, onOpen }: { vessel: TankMapVessel; onOpen: () => void }) {
  const fill = vessel.fills[0];
  const color = fill ? accentFor(fill.flavorName) : null;
  const ratio = fill && fill.volumeBbl !== null && vessel.capacityBbl ? fill.volumeBbl / vessel.capacityBbl : fill ? 1 : 0;
  const brewed = fill ? fill.brewedAt ?? fill.filledAt : null;
  const shape = vessel.shape ?? defaultVesselShape(vessel.kind, vessel.capacityBbl);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col items-center rounded-xl border-2 bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      style={{ borderColor: color ?? undefined }}
      data-testid={`vessel-${vessel.id}`}
    >
      <div className="flex w-full items-baseline justify-between gap-2">
        <span className="text-base font-semibold">{vessel.name}</span>
        <span className="text-xs text-muted-foreground">{vessel.capacityBbl ? `${vessel.capacityBbl} bbl` : VESSEL_KIND_LABELS[vessel.kind]}</span>
      </div>
      <TankFigure shape={shape} ratio={ratio} color={color} />
      {fill ? (
        <div className="w-full text-center">
          <div className="truncate text-lg font-semibold leading-tight" style={{ color: color ?? undefined }}>{fill.flavorName}</div>
          <div className="text-sm">{fill.volumeBbl !== null ? bbl(fill.volumeBbl) : ""}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {vessel.kind === "fermenter"
              ? `Brewed ${dateWord(fill.filledAt)} · ${dayWord(daysSince(fill.filledAt))}`
              : `In since ${dateWord(fill.filledAt)} · ${dayWord(daysSince(fill.filledAt))}`}
          </div>
          {vessel.kind !== "fermenter" && brewed && brewed !== fill.filledAt && (
            <div className="text-xs text-muted-foreground">Brewed {dateWord(brewed)}</div>
          )}
        </div>
      ) : (
        <div className="py-2 text-center">
          <div className="text-sm font-medium text-muted-foreground">Empty</div>
          <div className="text-xs text-muted-foreground">Tap to fill</div>
        </div>
      )}
    </button>
  );
}

function FridgeCard({ vessel, onOpen }: { vessel: TankMapVessel; onOpen: () => void }) {
  const kegs = vessel.fills.reduce((s, f) => s + (f.kegs ?? 0), 0);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex h-full min-h-[18rem] w-full flex-col rounded-2xl border-2 bg-card p-3 text-left shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`vessel-${vessel.id}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-semibold">{vessel.name}</span>
        <span className="text-xs text-muted-foreground">½ bbl kegs</span>
      </div>
      <div className="relative mt-2 flex-1 space-y-2 rounded-xl border bg-muted/30 p-2">
        <span className="absolute -left-1 top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-full bg-foreground/30" aria-hidden="true" />
        {vessel.fills.length === 0 && <p className="p-2 text-sm text-muted-foreground">No kegs</p>}
        {vessel.fills.map((f) => (
          <div key={f.id} className="rounded-md px-2 py-1.5 text-white shadow-sm" style={{ background: accentFor(f.flavorName) }}>
            <div className="flex items-baseline justify-between gap-2 text-sm font-semibold">
              <span className="truncate">{f.flavorName}</span>
              <span className="shrink-0">× {f.kegs ?? 0}</span>
            </div>
            <div className="text-[11px] opacity-90">In {dateWord(f.filledAt)} · {dayWord(daysSince(f.filledAt))}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {kegs > 0 ? `${kegs} half-barrel${kegs === 1 ? "" : "s"} · ${round(kegs * BBL_PER_HALF_BBL_KEG * 31)} gal` : "Tap to add kegs"}
      </div>
    </button>
  );
}

/** Three brite tanks in an L: down the left, then along the bottom. */
function lPosition(index: number, count: number): { gridColumn: number; gridRow: number } {
  const down = Math.max(1, Math.ceil((count + 1) / 2));
  return index < down ? { gridColumn: 1, gridRow: index + 1 } : { gridColumn: index - down + 2, gridRow: down };
}

function Zone({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function FlavorDot({ name }: { name: string }) {
  return <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: accentFor(name) }} aria-hidden="true" />;
}

/** The planning view: what to brew next, what is ready to package, what is kegged. */
function Summary({ vessels }: { vessels: TankMapVessel[] }) {
  const fermenters = vessels.filter((v) => v.kind === "fermenter");
  const brites = vessels.filter((v) => v.kind === "brite");
  const fridges = vessels.filter((v) => v.kind === "fridge");
  const emptyFermenters = fermenters.filter((v) => v.fills.length === 0);
  const fullBrites = brites.filter((v) => v.fills.length > 0);
  const emptyBrites = brites.filter((v) => v.fills.length === 0);
  const kegsByFlavor = new Map<string, number>();
  for (const f of fridges.flatMap((v) => v.fills)) kegsByFlavor.set(f.flavorName, (kegsByFlavor.get(f.flavorName) ?? 0) + (f.kegs ?? 0));
  const kegTotal = Array.from(kegsByFlavor.values()).reduce((s, n) => s + n, 0);
  const names = (vs: TankMapVessel[]) => vs.map((v) => v.name).join(", ");
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Card data-testid="summary-fermenting">
        <CardContent className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fermenting</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {fermenters.filter((v) => v.fills.length).map((v) => (
              <li key={v.id}><FlavorDot name={v.fills[0].flavorName} />{v.name} · {v.fills[0].flavorName} · {dayWord(daysSince(v.fills[0].filledAt))}</li>
            ))}
            {fermenters.every((v) => !v.fills.length) && <li className="text-muted-foreground">Nothing fermenting</li>}
          </ul>
          <p className="mt-2 text-sm font-medium">
            {emptyFermenters.length ? `Brew next into ${names(emptyFermenters)}` : fermenters.length ? "Every fermenter is full" : ""}
          </p>
        </CardContent>
      </Card>
      <Card data-testid="summary-package">
        <CardContent className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ready to package</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {fullBrites.map((v) => (
              <li key={v.id}>
                <FlavorDot name={v.fills[0].flavorName} />{v.name} · {v.fills[0].flavorName}
                {v.fills[0].volumeBbl !== null && ` · ${bbl(v.fills[0].volumeBbl)}, ${packagesWord(v.fills[0].volumeBbl)}`}
              </li>
            ))}
            {!fullBrites.length && <li className="text-muted-foreground">Nothing in the brites</li>}
          </ul>
          <p className="mt-2 text-sm font-medium">{emptyBrites.length ? `Empty: ${names(emptyBrites)}` : brites.length ? "Every brite is full" : ""}</p>
        </CardContent>
      </Card>
      <Card data-testid="summary-kegs">
        <CardContent className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kegs in the fridge</div>
          <p className="mt-1 text-sm font-medium">{kegTotal ? `${kegTotal} half-barrel${kegTotal === 1 ? "" : "s"} · ${round(kegTotal * BBL_PER_HALF_BBL_KEG * 31)} gal` : "None"}</p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {Array.from(kegsByFlavor.entries()).map(([name, n]) => (
              <li key={name}><FlavorDot name={name} />{name} · {kegWord(n)}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

type ActivityEvent = { at: string; text: string; flavor: string; key: string };

/** The last few things that happened, read off the fills. */
function RecentActivity({ recent }: { recent: TankMapFill[] }) {
  const events = useMemo(() => {
    const out: ActivityEvent[] = [];
    for (const f of recent) {
      const amount = amountWord(f);
      const what = `${amount ? `${amount} of ` : ""}${f.flavorName}`;
      const amountIn = amountInWord(f);
      const whatWentIn = `${amountIn ? `${amountIn} of ` : ""}${f.flavorName}`;
      if (f.fromFillId) {
        if (f.fromVesselName && f.fromVesselName !== f.vesselName) {
          out.push({ at: f.filledAt, text: `${whatWentIn} moved from ${f.fromVesselName} to ${f.vesselName}`, flavor: f.flavorName, key: `${f.id}-in` });
        }
      } else {
        out.push({ at: f.filledAt, text: `${f.vesselName} filled with ${whatWentIn}`, flavor: f.flavorName, key: `${f.id}-in` });
      }
      if (f.emptiedAt && f.outcome && f.outcome !== "moved") {
        const verb: Record<Exclude<FillOutcome, "moved">, string> = { packaged: "packaged", delivered: "out of", dumped: "dumped", other: "emptied" };
        const text = f.outcome === "delivered" ? `${what} out of ${f.vesselName}` : `${what} ${verb[f.outcome]} from ${f.vesselName}`;
        out.push({ at: f.emptiedAt, text, flavor: f.flavorName, key: `${f.id}-out` });
      }
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 15);
  }, [recent]);
  if (!events.length) return null;
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent</div>
        <ul className="mt-1 divide-y text-sm" data-testid="recent-activity">
          {events.map((e) => (
            <li key={e.key} className="flex items-baseline gap-3 py-1.5">
              <span className="w-14 shrink-0 text-muted-foreground">{dateWord(e.at)}</span>
              <span><FlavorDot name={e.flavor} />{e.text}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── The dialog: everything that can be recorded about one vessel ────────────────

type Mode = "view" | "fill" | "edit" | "move" | "empty";
type Action = { method: string; url: string; body?: unknown; done: string };

function FlavorSelect({ value, onChange, flavors }: { value: string; onChange: (id: string) => void; flavors: TankMapData["flavors"] }) {
  const active = flavors.filter((f) => f.isActive || f.id === value);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger data-testid="select-flavor"><SelectValue placeholder="Flavor" /></SelectTrigger>
      <SelectContent>
        {active.map((f) => (
          <SelectItem key={f.id} value={f.id}>
            <span className="inline-flex items-center"><FlavorDot name={f.name} />{f.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FillForm({ vessel, flavors, initial, pending, onSubmit, onCancel }: {
  vessel: TankMapVessel;
  flavors: TankMapData["flavors"];
  initial: TankMapFill | null;
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel?: () => void;
}) {
  const isFridge = vessel.kind === "fridge";
  const [flavorId, setFlavorId] = useState(initial?.flavorId ?? "");
  const [date, setDate] = useState(initial ? inputDate(initial.filledAt) : todayInput());
  const [brewed, setBrewed] = useState(initial ? inputDate(initial.brewedAt) : "");
  const [amount, setAmount] = useState(
    initial ? String(isFridge ? initial.kegs ?? "" : initial.volumeBbl ?? "") : isFridge ? "1" : String(vessel.capacityBbl ?? ""),
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const n = Number(amount);
  const ok = !!flavorId && !!date && Number.isFinite(n) && n > 0;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onSubmit({
          flavorId,
          filledAt: fromInput(date),
          brewedAt: vessel.kind === "fermenter" ? undefined : fromInput(brewed) ?? null,
          ...(isFridge ? { kegs: n } : { volumeBbl: n }),
          notes: notes.trim() || null,
        });
      }}
    >
      <div className="space-y-1">
        <Label>Flavor</Label>
        <FlavorSelect value={flavorId} onChange={setFlavorId} flavors={flavors} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="fill-amount">{isFridge ? "Half-barrel kegs" : "Barrels"}</Label>
          <Input id="fill-amount" type="number" inputMode="decimal" step={isFridge ? "1" : "0.5"} min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-amount" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fill-date">{vessel.kind === "fermenter" ? "Brewed" : "Went in"}</Label>
          <Input id="fill-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-date" />
        </div>
      </div>
      {vessel.kind !== "fermenter" && (
        <div className="space-y-1">
          <Label htmlFor="fill-brewed">Brewed <span className="font-normal text-muted-foreground">(if you know it)</span></Label>
          <Input id="fill-brewed" type="date" value={brewed} onChange={(e) => setBrewed(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="fill-notes">Notes</Label>
        <Textarea id="fill-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Gravity, dry hop, anything worth remembering" />
      </div>
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>}
        <Button type="submit" disabled={!ok || pending} data-testid="button-save-fill">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? "Save" : isFridge ? "Add kegs" : `Fill ${vessel.name}`}
        </Button>
      </div>
    </form>
  );
}

function MoveForm({ fill, vessel, vessels, pending, onSubmit, onCancel }: {
  fill: TankMapFill;
  vessel: TankMapVessel;
  vessels: TankMapVessel[];
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const options = vessels.filter((v) => v.id !== vessel.id && (v.kind === "fridge" || v.fills.length === 0));
  const preferred = options.find((v) => (vessel.kind === "fermenter" ? v.kind === "brite" : v.kind === "fridge")) ?? options[0];
  const [toId, setToId] = useState(preferred?.id ?? "");
  const to = options.find((v) => v.id === toId);
  const have = fill.volumeBbl ?? (fill.kegs ?? 0) * BBL_PER_HALF_BBL_KEG;
  const defaultAmount = (dest: TankMapVessel | undefined) =>
    !dest ? "" : dest.kind === "fridge" ? String(Math.max(1, Math.floor(have / BBL_PER_HALF_BBL_KEG + 1e-9))) : String(Math.min(have, dest.capacityBbl ?? have));
  const [amount, setAmount] = useState(defaultAmount(preferred));
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const n = Number(amount);
  const movedBbl = to?.kind === "fridge" ? n * BBL_PER_HALF_BBL_KEG : n;
  const remaining = have - movedBbl;
  const ok = !!to && Number.isFinite(n) && n > 0 && movedBbl <= have + 0.05;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || !to) return;
        onSubmit({ toVesselId: to.id, movedAt: fromInput(date), ...(to.kind === "fridge" ? { kegs: n } : { volumeBbl: n }), notes: notes.trim() || null });
      }}
    >
      <div className="space-y-1">
        <Label>Move {fill.flavorName} to</Label>
        <Select value={toId} onValueChange={(id) => { setToId(id); setAmount(defaultAmount(options.find((v) => v.id === id))); }}>
          <SelectTrigger data-testid="select-destination"><SelectValue placeholder="Where it went" /></SelectTrigger>
          <SelectContent>
            {options.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.name} · {VESSEL_KIND_LABELS[v.kind]}{v.capacityBbl ? `, ${v.capacityBbl} bbl` : ""}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!options.length && <p className="text-sm text-destructive">Every other tank is full.</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="move-amount">{to?.kind === "fridge" ? "Half-barrel kegs filled" : "Barrels moved"}</Label>
          <Input id="move-amount" type="number" inputMode="decimal" step={to?.kind === "fridge" ? "1" : "0.5"} min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-move-amount" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="move-date">On</Label>
          <Input id="move-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {have > 0 && (remaining > 0.05
          ? `${vessel.name} keeps ${bbl(remaining)}.`
          : movedBbl > have + 0.05
            ? `${vessel.name} only has ${bbl(have)}.`
            : `${vessel.name} will be empty.`)}
        {to?.kind === "fridge" && " A half-barrel is 15.5 gallons."}
      </p>
      <div className="space-y-1">
        <Label htmlFor="move-notes">Notes</Label>
        <Textarea id="move-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!ok || pending} data-testid="button-save-move">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Move
        </Button>
      </div>
    </form>
  );
}

function EmptyForm({ fill, vessel, pending, onSubmit, onCancel }: {
  fill: TankMapFill;
  vessel: TankMapVessel;
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const isFridge = vessel.kind === "fridge";
  const choices: Exclude<FillOutcome, "moved">[] = isFridge ? ["delivered", "dumped", "other"] : ["packaged", "dumped", "other"];
  const [outcome, setOutcome] = useState<Exclude<FillOutcome, "moved">>(choices[0]);
  const have = isFridge ? fill.kegs ?? 0 : fill.volumeBbl ?? 0;
  const [amount, setAmount] = useState(String(have));
  const [date, setDate] = useState(todayInput());
  const [notes, setNotes] = useState("");
  const n = Number(amount);
  const ok = Number.isFinite(n) && n > 0 && n <= have + 0.05;
  const remaining = have - n;
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onSubmit({ outcome, emptiedAt: fromInput(date), ...(isFridge ? { kegs: n } : { volumeBbl: n }), notes: notes.trim() || null });
      }}
    >
      <div className="flex flex-wrap gap-2">
        {choices.map((c) => (
          <Button key={c} type="button" size="sm" variant={outcome === c ? "default" : "outline"} onClick={() => setOutcome(c)} data-testid={`outcome-${c}`}>
            {FILL_OUTCOME_LABELS[c]}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="empty-amount">{isFridge ? "Kegs out" : "Barrels out"}</Label>
          <Input id="empty-amount" type="number" inputMode="decimal" step={isFridge ? "1" : "0.5"} min="0" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="input-empty-amount" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="empty-date">On</Label>
          <Input id="empty-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {remaining > 0.05 ? `${isFridge ? kegWord(Math.round(remaining)) : bbl(remaining)} stay${isFridge && Math.round(remaining) !== 1 ? "" : "s"} in ${vessel.name}.` : n > have + 0.05 ? `${vessel.name} only has ${isFridge ? kegWord(have) : bbl(have)}.` : `${vessel.name} will be empty.`}
        {!isFridge && outcome === "packaged" && n > 0 && ` ${packagesWord(n)}.`}
      </p>
      <div className="space-y-1">
        <Label htmlFor="empty-notes">Notes</Label>
        <Textarea id="empty-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={outcome === "packaged" ? "Cases and kegs filled" : ""} />
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={!ok || pending} data-testid="button-save-empty">
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{FILL_OUTCOME_LABELS[outcome]}
        </Button>
      </div>
    </form>
  );
}

function VesselSettings({ vessel, pending, onSubmit, onCancel }: {
  vessel: TankMapVessel;
  pending: boolean;
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(vessel.name);
  const [capacity, setCapacity] = useState(vessel.capacityBbl === null ? "" : String(vessel.capacityBbl));
  const [shape, setShape] = useState<VesselShape>(vessel.shape ?? defaultVesselShape(vessel.kind, vessel.capacityBbl));
  const ok = name.trim().length > 0 && (vessel.kind === "fridge" || Number(capacity) > 0);
  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onSubmit({ name: name.trim(), ...(vessel.kind === "fridge" ? {} : { capacityBbl: Number(capacity), shape }) });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="vessel-name">Name</Label>
          <Input id="vessel-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </div>
        {vessel.kind !== "fridge" && (
          <div className="space-y-1">
            <Label htmlFor="vessel-capacity">Size, bbl</Label>
            <Input id="vessel-capacity" type="number" inputMode="decimal" step="0.5" min="0" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
          </div>
        )}
      </div>
      {vessel.kind !== "fridge" && (
        <div className="space-y-1">
          <Label>Drawn as</Label>
          <Select value={shape} onValueChange={(v) => setShape(v as VesselShape)}>
            <SelectTrigger data-testid="select-shape"><SelectValue /></SelectTrigger>
            <SelectContent>
              {VESSEL_SHAPES.map((s) => <SelectItem key={s} value={s}>{VESSEL_SHAPE_LABELS[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={!ok || pending}>Save vessel</Button>
      </div>
    </form>
  );
}

function FillDetails({ fill, vessel }: { fill: TankMapFill; vessel: TankMapVessel }) {
  const color = accentFor(fill.flavorName);
  const brewed = fill.brewedAt ?? (vessel.kind === "fermenter" ? fill.filledAt : null);
  return (
    <div className="rounded-lg border-l-4 bg-muted/30 p-3" style={{ borderLeftColor: color }}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-lg font-semibold" style={{ color }}>{fill.flavorName}</span>
        <span className="text-sm">
          {amountWord(fill)}
          {amountInWord(fill) !== amountWord(fill) && <span className="text-muted-foreground"> of {amountInWord(fill)} in</span>}
        </span>
      </div>
      <div className="mt-1 text-sm text-muted-foreground">
        {vessel.kind === "fermenter"
          ? `Brewed ${dateWord(fill.filledAt)}, ${dayWord(daysSince(fill.filledAt))} ago`
          : `In since ${dateWord(fill.filledAt)}, ${dayWord(daysSince(fill.filledAt))}${brewed ? `; brewed ${dateWord(brewed)}, ${dayWord(daysSince(brewed))} ago` : ""}`}
        {fill.fromVesselName && fill.fromVesselName !== vessel.name && ` · from ${fill.fromVesselName}`}
      </div>
      {fill.volumeBbl !== null && vessel.kind !== "fermenter" && <div className="text-sm text-muted-foreground">{packagesWord(fill.volumeBbl)}</div>}
      {fill.notes && <p className="mt-1 whitespace-pre-line text-sm">{fill.notes}</p>}
    </div>
  );
}

function VesselDialog({ vessel, data, onClose }: { vessel: TankMapVessel | null; data: TankMapData; onClose: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const isElevated = user?.role === "admin" || user?.role === "super_admin";
  const [mode, setMode] = useState<Mode>("view");
  const [target, setTarget] = useState<TankMapFill | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    setMode("view");
    setTarget(null);
    setConfirmRemove(null);
    setSettings(false);
  }, [vessel?.id]);

  const act = useMutation({
    mutationFn: async (a: Action) => {
      await apiRequest(a.method, a.url, a.body);
      return a;
    },
    // The map is the confirmation: once something is recorded the dialog gets out of the way.
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      toast({ title: a.done });
      onClose();
    },
    onError: (e) => toast({ title: "That didn't save", description: apiErrorMessage(e, "Something went wrong"), variant: "destructive" }),
  });

  if (!vessel) return null;
  const isFridge = vessel.kind === "fridge";
  const tankFill = isFridge ? null : vessel.fills[0] ?? null;
  const pending = act.isPending;
  const start = (m: Mode, f: TankMapFill | null) => { setMode(m); setTarget(f); setConfirmRemove(null); };

  const fillActions = (f: TankMapFill) => (
    <div className="flex flex-wrap gap-2">
      {!isFridge && (
        <Button size="sm" onClick={() => start("move", f)} data-testid="button-move"><ArrowRightLeft className="mr-1.5 h-4 w-4" />Move to…</Button>
      )}
      <Button size="sm" variant={isFridge ? "default" : "secondary"} onClick={() => start("empty", f)} data-testid="button-empty">
        <PackageOpen className="mr-1.5 h-4 w-4" />{isFridge ? "Kegs out" : "Packaged or dumped"}
      </Button>
      <Button size="sm" variant="outline" onClick={() => start("edit", f)} data-testid="button-edit"><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>
      {confirmRemove === f.id ? (
        <Button size="sm" variant="destructive" disabled={pending} onClick={() => act.mutate({ method: "DELETE", url: `/api/tank-map/fills/${f.id}`, done: "Removed" })} data-testid="button-remove-confirm">
          Yes, it was never there
        </Button>
      ) : (
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmRemove(f.id)} data-testid="button-remove">
          <Trash2 className="mr-1.5 h-4 w-4" />Entered by mistake
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="vessel-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between gap-2">
            <span>{vessel.name}</span>
            {isElevated && (
              <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" title="Rename or resize" aria-label="Rename or resize" onClick={() => setSettings((s) => !s)} data-testid="button-vessel-settings">
                <Settings2 className="h-4 w-4" />
              </Button>
            )}
          </DialogTitle>
          <DialogDescription>
            {VESSEL_KIND_LABELS[vessel.kind]}{vessel.shape ? `, ${SHAPE_WORDS[vessel.shape]}` : ""}{vessel.capacityBbl ? `, ${vessel.capacityBbl} bbl` : ""}{vessel.notes ? ` · ${vessel.notes}` : ""}
          </DialogDescription>
        </DialogHeader>

        {settings && (
          <VesselSettings vessel={vessel} pending={pending} onCancel={() => setSettings(false)}
            onSubmit={(body) => act.mutate({ method: "PATCH", url: `/api/tank-map/vessels/${vessel.id}`, body, done: "Vessel saved" })} />
        )}

        {/* A tank: one thing at a time. */}
        {!isFridge && !tankFill && mode !== "fill" && (
          <FillForm vessel={vessel} flavors={data.flavors} initial={null} pending={pending}
            onSubmit={(body) => act.mutate({ method: "POST", url: `/api/tank-map/vessels/${vessel.id}/fills`, body, done: `${vessel.name} filled` })} />
        )}
        {!isFridge && tankFill && mode === "view" && (
          <div className="space-y-3">
            <FillDetails fill={tankFill} vessel={vessel} />
            {fillActions(tankFill)}
          </div>
        )}

        {/* The fridge: a shelf of keg groups, and room for more. */}
        {isFridge && mode === "view" && (
          <div className="space-y-3">
            {vessel.fills.length === 0 && <p className="text-sm text-muted-foreground">No kegs in the fridge.</p>}
            {vessel.fills.map((f) => (
              <div key={f.id} className="space-y-2">
                <FillDetails fill={f} vessel={vessel} />
                {fillActions(f)}
              </div>
            ))}
            <Button variant="outline" onClick={() => start("fill", null)} data-testid="button-add-kegs"><Plus className="mr-1.5 h-4 w-4" />Add kegs</Button>
          </div>
        )}
        {isFridge && mode === "fill" && (
          <FillForm vessel={vessel} flavors={data.flavors} initial={null} pending={pending} onCancel={() => setMode("view")}
            onSubmit={(body) => act.mutate({ method: "POST", url: `/api/tank-map/vessels/${vessel.id}/fills`, body, done: "Kegs added" })} />
        )}

        {mode === "edit" && target && (
          <FillForm vessel={vessel} flavors={data.flavors} initial={target} pending={pending} onCancel={() => setMode("view")}
            onSubmit={(body) => act.mutate({ method: "PATCH", url: `/api/tank-map/fills/${target.id}`, body, done: "Saved" })} />
        )}
        {mode === "move" && target && (
          <MoveForm fill={target} vessel={vessel} vessels={data.vessels} pending={pending} onCancel={() => setMode("view")}
            onSubmit={(body) => act.mutate({ method: "POST", url: `/api/tank-map/fills/${target.id}/move`, body, done: "Moved" })} />
        )}
        {mode === "empty" && target && (
          <EmptyForm fill={target} vessel={vessel} pending={pending} onCancel={() => setMode("view")}
            onSubmit={(body) => act.mutate({ method: "POST", url: `/api/tank-map/fills/${target.id}/empty`, body, done: FILL_OUTCOME_LABELS[body.outcome as FillOutcome] })} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── The page ───────────────────────────────────────────────────────────────────

export default function TankMapPage() {
  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useQuery<TankMapData>({
    queryKey: QUERY_KEY,
    refetchInterval: 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const vessels = data?.vessels ?? [];
  const byKind = (kind: VesselKind) => vessels.filter((v) => v.kind === kind);
  const brites = byKind("brite");
  const fermenters = byKind("fermenter");
  const fridges = byKind("fridge");
  const selected = vessels.find((v) => v.id === selectedId) ?? null;

  return (
    <StaffLayout>
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-page-title">Tank Map</h1>
            <p className="text-sm text-muted-foreground">
              What's in the fermenters, the brite tanks and the keg fridge. Tap a vessel to record what went in, moved on or came out.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {dataUpdatedAt ? `Updated ${formatInTimeZone(new Date(dataUpdatedAt), TZ, "h:mm a")}` : ""}
            <Button variant="ghost" size="icon" onClick={() => refetch()} aria-label="Refresh" data-testid="button-refresh">
              <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>

        {isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}
        {error && <p className="text-sm text-destructive">Couldn't load the tank map: {apiErrorMessage(error, "the server didn't answer")}</p>}

        {data && (
          <>
            <Summary vessels={vessels} />

            {/* The floor: brites in an L on the left, the fermenters' square in the middle, the fridge on the right. */}
            <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,2.3fr)_minmax(0,1.3fr)]" data-testid="tank-map">
              <Zone title="Brite tanks">
                <div className="grid grid-cols-2 gap-4">
                  {brites.map((v, i) => (
                    <div key={v.id} style={lPosition(i, brites.length)}>
                      <TankCard vessel={v} onOpen={() => setSelectedId(v.id)} />
                    </div>
                  ))}
                  {!brites.length && <p className="col-span-2 text-sm text-muted-foreground">No brite tanks set up.</p>}
                </div>
              </Zone>
              <Zone title="Fermenters">
                <div className="grid grid-cols-2 gap-4">
                  {fermenters.map((v) => <TankCard key={v.id} vessel={v} onOpen={() => setSelectedId(v.id)} />)}
                  {!fermenters.length && <p className="col-span-2 text-sm text-muted-foreground">No fermenters set up.</p>}
                </div>
              </Zone>
              <Zone title="Keg fridge" className="flex flex-col">
                <div className="flex flex-1 flex-col gap-4">
                  {fridges.map((v) => <FridgeCard key={v.id} vessel={v} onOpen={() => setSelectedId(v.id)} />)}
                  {!fridges.length && <p className="text-sm text-muted-foreground">No fridge set up.</p>}
                </div>
              </Zone>
            </div>

            <RecentActivity recent={data.recent} />
          </>
        )}
      </div>

      {data && <VesselDialog vessel={selected} data={data} onClose={() => setSelectedId(null)} />}
    </StaffLayout>
  );
}
