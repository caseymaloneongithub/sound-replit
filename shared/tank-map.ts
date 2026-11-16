/**
 * The tank map (owner, 2026-11-16): "a visual map of my 4 fermenters (three 7 bbl, one
 * 10 bbl), brite tanks (three 10 bbl) and fridge (storage for 1/2 barrel kegs for smaller
 * batches), so I know what's in them at any time and can plan brewing and know what's
 * available to package."
 *
 * Vessels and what is in them live in vessels / vessel_fills (shared/schema.ts). A fill
 * is one thing in one vessel from the day it went in until the day it left: the open
 * fills are the map, the closed ones the history. This file holds what the page and
 * the server share: the vessel kinds, the arithmetic from barrels to packages, and the
 * shapes of the requests and of the map itself.
 */
import { z } from "zod";
import { GALLONS_PER_CASE, GALLONS_PER_KEG } from "./profitability";

export const VESSEL_KINDS = ["fermenter", "brite", "fridge"] as const;
export type VesselKind = (typeof VESSEL_KINDS)[number];
export const VESSEL_KIND_LABELS: Record<VesselKind, string> = {
  fermenter: "Fermenter",
  brite: "Brite tank",
  fridge: "Keg fridge",
};

/** How a vessel is drawn. Owner, 2026-11-16: "Our brite tanks are conical. Our small fermenters are pots. The large fermenter is an IBC tote." */
export const VESSEL_SHAPES = ["conical", "pot", "tote"] as const;
export type VesselShape = (typeof VESSEL_SHAPES)[number];
export const VESSEL_SHAPE_LABELS: Record<VesselShape, string> = {
  conical: "Conical tank",
  pot: "Pot",
  tote: "IBC tote",
};
/** The shape a vessel takes when none is set: brites are conical, fermenters pots, a 10 bbl fermenter a tote. */
export function defaultVesselShape(kind: VesselKind, capacityBbl: number | null): VesselShape {
  if (kind === "brite") return "conical";
  return (capacityBbl ?? 0) >= 10 ? "tote" : "pot";
}

export const GALLONS_PER_BBL = 31;
/** The fridge holds half-barrel kegs. */
export const HALF_BBL_KEG_GALLONS = 15.5;
export const BBL_PER_HALF_BBL_KEG = HALF_BBL_KEG_GALLONS / GALLONS_PER_BBL;

/** What a volume packages into before any waste: cases of twelve cans, half-barrel kegs, sixth-barrel kegs. */
export function packagesFromBbl(bbl: number) {
  const gallons = bbl * GALLONS_PER_BBL;
  return {
    gallons,
    cases: gallons / GALLONS_PER_CASE,
    halfBarrels: gallons / HALF_BBL_KEG_GALLONS,
    sixtels: gallons / GALLONS_PER_KEG,
  };
}

/** How a fill left its vessel. "moved" is set by a move; the rest are what the staff pick. */
export const FILL_OUTCOMES = ["moved", "packaged", "delivered", "dumped", "other"] as const;
export type FillOutcome = (typeof FILL_OUTCOMES)[number];
export const FILL_OUTCOME_LABELS: Record<FillOutcome, string> = {
  moved: "Moved",
  packaged: "Packaged",
  delivered: "Kegs out",
  dumped: "Dumped",
  other: "Emptied",
};

// Request shapes. Dates arrive as ISO strings (or nothing, meaning now); blanks are dropped.
const when = z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.date().optional());
const bbl = z.coerce.number().finite().min(0).max(1000);
const kegCount = z.coerce.number().int().min(0).max(10_000);
const note = z.string().trim().max(500).nullish().transform((v) => (v ? v : null));

export const fillInputSchema = z.object({
  flavorId: z.string().min(1, "Pick a flavor"),
  /** When it went in; now when left out. */
  filledAt: when,
  /** For a brite tank or the fridge: when the batch was brewed, if known. A fermenter's own filledAt is its brew date. */
  brewedAt: when,
  /** Tanks: barrels in. Left out, the vessel's capacity. */
  volumeBbl: bbl.nullish(),
  /** The fridge: half-barrel kegs in. */
  kegs: kegCount.nullish(),
  notes: note,
});
export type FillInput = z.infer<typeof fillInputSchema>;

export const fillUpdateSchema = fillInputSchema.partial();
export type FillUpdate = z.infer<typeof fillUpdateSchema>;

export const moveInputSchema = z.object({
  toVesselId: z.string().min(1, "Pick where it went"),
  movedAt: when,
  /** Into a tank: barrels moved; less than the source holds leaves the rest where it was. */
  volumeBbl: bbl.nullish(),
  /** Into the fridge: half-barrel kegs filled. */
  kegs: kegCount.nullish(),
  notes: note,
});
export type MoveInput = z.infer<typeof moveInputSchema>;

export const emptyInputSchema = z.object({
  outcome: z.enum(["packaged", "delivered", "dumped", "other"]),
  emptiedAt: when,
  /** Tanks: barrels out; fewer than the fill holds leaves the rest in the tank. */
  volumeBbl: bbl.nullish(),
  /** The fridge: kegs out; fewer than the fill holds leaves the rest. */
  kegs: kegCount.nullish(),
  notes: note,
});
export type EmptyInput = z.infer<typeof emptyInputSchema>;

export const vesselUpdateSchema = z.object({
  name: z.string().trim().min(1, "Give it a name").max(40).optional(),
  capacityBbl: bbl.nullable().optional(),
  shape: z.enum(VESSEL_SHAPES).nullable().optional(),
  notes: note.optional(),
  isActive: z.boolean().optional(),
});
export type VesselUpdate = z.infer<typeof vesselUpdateSchema>;

// What GET /api/tank-map returns.
export type TankMapFill = {
  id: string;
  vesselId: string;
  vesselName: string;
  flavorId: string;
  flavorName: string;
  filledAt: string;
  brewedAt: string | null;
  /** What is in it now (or was, when it closed). */
  volumeBbl: number | null;
  kegs: number | null;
  /** What went in; the same until a part moves on or leaves. */
  volumeBblIn: number | null;
  kegsIn: number | null;
  notes: string | null;
  emptiedAt: string | null;
  outcome: FillOutcome | null;
  fromFillId: string | null;
  /** Where it came from, when it came from a move or was split off a larger fill. */
  fromVesselName: string | null;
};

export type TankMapVessel = {
  id: string;
  name: string;
  kind: VesselKind;
  capacityBbl: number | null;
  /** How it is drawn; null for the fridge. */
  shape: VesselShape | null;
  displayOrder: number;
  notes: string | null;
  /** What is in it now: at most one fill in a tank, any number in the fridge. */
  fills: TankMapFill[];
};

export type TankMapData = {
  vessels: TankMapVessel[];
  flavors: { id: string; name: string; isActive: boolean }[];
  /** The latest fills, open and closed, newest activity first. */
  recent: TankMapFill[];
};
