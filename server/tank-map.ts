/**
 * The tank map (owner, 2026-11-16; the words are in shared/tank-map.ts). Staff and
 * admins read it and record what went in, what moved on and what came out; renaming a
 * vessel or changing its size is admin-and-up.
 *
 * One rule keeps the map honest: a fermenter or brite tank holds one fill at a time,
 * while the fridge holds any number, each counted in half-barrel kegs. A move closes
 * the fill where it was (outcome "moved") and opens one where it went, in one
 * transaction, carrying the brew date along; moving or taking out less than a vessel
 * holds leaves the rest there, with the part that left recorded as its own closed fill
 * so the history stays complete.
 */
import type { Express } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "./db";
import { flavors, vesselFills, vessels, type VesselFill } from "@shared/schema";
import {
  HALF_BBL_KEG_GALLONS,
  REMAINDER_GALLONS,
  emptyInputSchema,
  fillInputSchema,
  fillUpdateSchema,
  moveInputSchema,
  vesselUpdateSchema,
  defaultVesselShape,
  type FillOutcome,
  type TankMapData,
  type TankMapFill,
  type VesselKind,
  type VesselShape,
} from "@shared/tank-map";

type Middleware = (req: any, res: any, next: any) => unknown;
type Querier = Pick<typeof db, "select">;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);
const galText = (n: number | null | undefined) => (n === null || n === undefined ? null : n.toFixed(2));
const fmtGal = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const firstIssue = (err: z.ZodError) => err.issues[0]?.message ?? "Check the form";
const userId = (req: any): string | null => (req.originalUser || req.user)?.id ?? null;

function sendError(res: any, e: unknown, fallback: string) {
  if (e instanceof HttpError) return res.status(e.status).json({ message: e.message });
  console.error(`[tank-map] ${fallback}:`, e);
  return res.status(500).json({ message: fallback });
}

async function openFillsIn(q: Querier, vesselId: string) {
  return q.select().from(vesselFills).where(and(eq(vesselFills.vesselId, vesselId), isNull(vesselFills.emptiedAt)));
}

/** A fill's size in gallons, whichever way it is counted. */
const fillGallons = (f: Pick<VesselFill, "volumeGal" | "kegs">) => num(f.volumeGal) ?? (f.kegs ?? 0) * HALF_BBL_KEG_GALLONS;

export function registerTankMapRoutes(
  app: Express,
  deps: { isAuthenticated: Middleware; isStaffOrAdmin: Middleware; isAdmin: Middleware },
) {
  const { isAuthenticated, isStaffOrAdmin, isAdmin } = deps;

  app.get("/api/tank-map", isAuthenticated, isStaffOrAdmin, async (_req, res) => {
    try {
      const [allVessels, flavorRows, openFills, recentFills] = await Promise.all([
        db.select().from(vessels).orderBy(asc(vessels.displayOrder), asc(vessels.name)),
        db.select({ id: flavors.id, name: flavors.name, isActive: flavors.isActive }).from(flavors).orderBy(asc(flavors.displayOrder), asc(flavors.name)),
        db.select().from(vesselFills).where(isNull(vesselFills.emptiedAt)).orderBy(asc(vesselFills.filledAt)),
        db.select().from(vesselFills)
          .orderBy(desc(sql`greatest(${vesselFills.filledAt}, coalesce(${vesselFills.emptiedAt}, ${vesselFills.filledAt}))`))
          .limit(40),
      ]);
      const fromIds = Array.from(new Set([...openFills, ...recentFills].map((f) => f.fromFillId).filter((x): x is string => !!x)));
      const sources = fromIds.length
        ? await db.select({ id: vesselFills.id, vesselId: vesselFills.vesselId }).from(vesselFills).where(inArray(vesselFills.id, fromIds))
        : [];
      const vesselName = new Map(allVessels.map((v) => [v.id, v.name]));
      const flavorName = new Map(flavorRows.map((f) => [f.id, f.name]));
      const sourceVessel = new Map(sources.map((s) => [s.id, vesselName.get(s.vesselId) ?? null]));
      const shape = (f: VesselFill): TankMapFill => ({
        id: f.id,
        vesselId: f.vesselId,
        vesselName: vesselName.get(f.vesselId) ?? "?",
        flavorId: f.flavorId,
        flavorName: flavorName.get(f.flavorId) ?? "Unknown flavor",
        filledAt: iso(f.filledAt)!,
        brewedAt: iso(f.brewedAt),
        volumeGal: num(f.volumeGal),
        kegs: f.kegs,
        volumeGalIn: num(f.volumeGalIn) ?? num(f.volumeGal),
        kegsIn: f.kegsIn ?? f.kegs,
        notes: f.notes,
        emptiedAt: iso(f.emptiedAt),
        outcome: (f.outcome as FillOutcome | null) ?? null,
        fromFillId: f.fromFillId,
        fromVesselName: f.fromFillId ? sourceVessel.get(f.fromFillId) ?? null : null,
      });
      const data: TankMapData = {
        vessels: allVessels
          .filter((v) => v.isActive)
          .map((v) => ({
            id: v.id,
            name: v.name,
            kind: v.kind as VesselKind,
            capacityGal: num(v.capacityGal),
            shape: v.kind === "fridge" ? null : (v.shape as VesselShape | null) ?? defaultVesselShape(v.kind as VesselKind, num(v.capacityGal)),
            displayOrder: v.displayOrder,
            notes: v.notes,
            fills: openFills.filter((f) => f.vesselId === v.id).map(shape),
          })),
        flavors: flavorRows,
        recent: recentFills.map(shape),
      };
      res.json(data);
    } catch (e) {
      sendError(res, e, "Couldn't load the tank map");
    }
  });

  // Something went into a vessel.
  app.post("/api/tank-map/vessels/:id/fills", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    const parsed = fillInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const body = parsed.data;
    try {
      const [vessel] = await db.select().from(vessels).where(eq(vessels.id, req.params.id));
      if (!vessel || !vessel.isActive) throw new HttpError(404, "No such vessel");
      const [flavor] = await db.select({ id: flavors.id }).from(flavors).where(eq(flavors.id, body.flavorId));
      if (!flavor) throw new HttpError(400, "Pick a flavor");
      const kind = vessel.kind as VesselKind;
      const filledAt = body.filledAt ?? new Date();
      const row = await db.transaction(async (tx) => {
        if (kind !== "fridge" && (await openFillsIn(tx, vessel.id)).length) {
          throw new HttpError(409, `${vessel.name} isn't empty. Move or empty what's in it first.`);
        }
        const volume = kind === "fridge" ? null : body.volumeGal ?? num(vessel.capacityGal) ?? 0;
        if (kind !== "fridge" && !(volume! > 0)) throw new HttpError(400, "How many gallons went in?");
        const kegs = kind === "fridge" ? body.kegs ?? 0 : null;
        if (kind === "fridge" && !(kegs! > 0)) throw new HttpError(400, "How many kegs went in?");
        const [inserted] = await tx.insert(vesselFills).values({
          vesselId: vessel.id,
          flavorId: flavor.id,
          filledAt,
          brewedAt: kind === "fermenter" ? null : body.brewedAt ?? null,
          volumeGal: galText(volume),
          kegs,
          volumeGalIn: galText(volume),
          kegsIn: kegs,
          notes: body.notes ?? null,
          createdByUserId: userId(req),
        }).returning({ id: vesselFills.id });
        return inserted;
      });
      res.status(201).json(row);
    } catch (e) {
      sendError(res, e, "Couldn't record the fill");
    }
  });

  // Correct what was typed about something still in its vessel.
  app.patch("/api/tank-map/fills/:id", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    const parsed = fillUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const body = parsed.data;
    try {
      const [fill] = await db.select().from(vesselFills).where(eq(vesselFills.id, req.params.id));
      if (!fill) throw new HttpError(404, "No such fill");
      if (fill.emptiedAt) throw new HttpError(409, "That batch has already left its vessel.");
      const [vessel] = await db.select().from(vessels).where(eq(vessels.id, fill.vesselId));
      const kind = (vessel?.kind ?? "fermenter") as VesselKind;
      if (body.flavorId) {
        const [flavor] = await db.select({ id: flavors.id }).from(flavors).where(eq(flavors.id, body.flavorId));
        if (!flavor) throw new HttpError(400, "Pick a flavor");
      }
      const patch: Partial<typeof vesselFills.$inferInsert> = { updatedAt: new Date() };
      if (body.flavorId) patch.flavorId = body.flavorId;
      if (body.filledAt) patch.filledAt = body.filledAt;
      if ("brewedAt" in body) patch.brewedAt = kind === "fermenter" ? null : body.brewedAt ?? null;
      if ("notes" in body) patch.notes = body.notes ?? null;
      // A corrected amount moves the "as it went in" figure by the same difference, so a
      // batch that already lost a part keeps that part in its history.
      if (kind === "fridge") {
        if (body.kegs !== undefined && body.kegs !== null) {
          if (!(body.kegs > 0)) throw new HttpError(400, "How many kegs are in there?");
          patch.kegs = body.kegs;
          patch.kegsIn = (fill.kegsIn ?? fill.kegs ?? 0) + (body.kegs - (fill.kegs ?? 0));
        }
      } else if (body.volumeGal !== undefined && body.volumeGal !== null) {
        if (!(body.volumeGal > 0)) throw new HttpError(400, "How many gallons are in there?");
        patch.volumeGal = galText(body.volumeGal);
        patch.volumeGalIn = galText((num(fill.volumeGalIn) ?? num(fill.volumeGal) ?? 0) + (body.volumeGal - (num(fill.volumeGal) ?? 0)));
      }
      await db.update(vesselFills).set(patch).where(eq(vesselFills.id, fill.id));
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, "Couldn't save the change");
    }
  });

  // Fermenter to brite, brite to fridge: the batch moves on.
  app.post("/api/tank-map/fills/:id/move", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    const parsed = moveInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const body = parsed.data;
    try {
      await db.transaction(async (tx) => {
        const [source] = await tx.select().from(vesselFills).where(eq(vesselFills.id, req.params.id));
        if (!source) throw new HttpError(404, "No such fill");
        if (source.emptiedAt) throw new HttpError(409, "That batch has already left its vessel. Reload the map.");
        const [from] = await tx.select().from(vessels).where(eq(vessels.id, source.vesselId));
        const [to] = await tx.select().from(vessels).where(eq(vessels.id, body.toVesselId));
        if (!to || !to.isActive) throw new HttpError(404, "No such vessel");
        if (to.id === source.vesselId) throw new HttpError(400, "That's where it already is.");
        const toKind = to.kind as VesselKind;
        if (toKind !== "fridge" && (await openFillsIn(tx, to.id)).length) {
          throw new HttpError(409, `${to.name} isn't empty. Move or empty what's in it first.`);
        }
        const movedAt = body.movedAt ?? new Date();
        const have = fillGallons(source);
        let movedGal: number;
        let kegs: number | null = null;
        let volume: number | null = null;
        if (toKind === "fridge") {
          kegs = body.kegs ?? Math.max(1, Math.floor(have / HALF_BBL_KEG_GALLONS + 1e-9));
          if (!(kegs > 0)) throw new HttpError(400, "How many kegs were filled?");
          movedGal = kegs * HALF_BBL_KEG_GALLONS;
        } else {
          volume = body.volumeGal ?? have;
          if (!(volume > 0)) throw new HttpError(400, "How many gallons moved?");
          const cap = num(to.capacityGal);
          if (cap && volume > cap + REMAINDER_GALLONS) throw new HttpError(400, `${to.name} holds ${fmtGal(cap)} gal.`);
          movedGal = volume;
        }
        if (have > 0 && movedGal > have + REMAINDER_GALLONS) {
          throw new HttpError(400, `${from?.name ?? "That vessel"} only has ${fmtGal(have)} gal in it.`);
        }
        const remaining = have - movedGal;
        const now = new Date();
        await tx.insert(vesselFills).values({
          vesselId: to.id,
          flavorId: source.flavorId,
          filledAt: movedAt,
          brewedAt: source.brewedAt ?? source.filledAt,
          volumeGal: galText(volume),
          kegs,
          volumeGalIn: galText(volume),
          kegsIn: kegs,
          notes: body.notes ?? null,
          fromFillId: source.id,
          createdByUserId: userId(req),
        });
        if (have > 0 && remaining > REMAINDER_GALLONS) {
          // Part of it moved; the rest stays where it was.
          await tx.update(vesselFills)
            .set(source.kegs !== null
              ? { kegs: Math.round(remaining / HALF_BBL_KEG_GALLONS), updatedAt: now }
              : { volumeGal: galText(remaining), updatedAt: now })
            .where(eq(vesselFills.id, source.id));
        } else {
          await tx.update(vesselFills).set({ emptiedAt: movedAt, outcome: "moved", updatedAt: now }).where(eq(vesselFills.id, source.id));
        }
      });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, "Couldn't record the move");
    }
  });

  // Packaged, kegs out, dumped: the batch (or part of it) is gone.
  app.post("/api/tank-map/fills/:id/empty", isAuthenticated, isStaffOrAdmin, async (req: any, res) => {
    const parsed = emptyInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const body = parsed.data;
    try {
      await db.transaction(async (tx) => {
        const [fill] = await tx.select().from(vesselFills).where(eq(vesselFills.id, req.params.id));
        if (!fill) throw new HttpError(404, "No such fill");
        if (fill.emptiedAt) throw new HttpError(409, "That batch has already left its vessel. Reload the map.");
        const emptiedAt = body.emptiedAt ?? new Date();
        const now = new Date();
        const partialKegs = fill.kegs !== null && body.kegs !== undefined && body.kegs !== null && body.kegs < fill.kegs ? body.kegs : null;
        const have = num(fill.volumeGal);
        const partialGal = have !== null && body.volumeGal !== undefined && body.volumeGal !== null && body.volumeGal < have - REMAINDER_GALLONS ? body.volumeGal : null;
        if (partialKegs !== null || partialGal !== null) {
          if (partialKegs !== null && !(partialKegs > 0)) throw new HttpError(400, "How many kegs went out?");
          if (partialGal !== null && !(partialGal > 0)) throw new HttpError(400, "How many gallons went out?");
          // The part that left becomes its own closed fill, so the history has it; the rest stays.
          await tx.insert(vesselFills).values({
            vesselId: fill.vesselId,
            flavorId: fill.flavorId,
            filledAt: fill.filledAt,
            brewedAt: fill.brewedAt,
            volumeGal: partialGal !== null ? galText(partialGal) : null,
            kegs: partialKegs,
            volumeGalIn: partialGal !== null ? galText(partialGal) : null,
            kegsIn: partialKegs,
            notes: body.notes ?? null,
            emptiedAt,
            outcome: body.outcome,
            fromFillId: fill.id,
            createdByUserId: userId(req),
          });
          await tx.update(vesselFills)
            .set(partialKegs !== null
              ? { kegs: (fill.kegs ?? 0) - partialKegs, updatedAt: now }
              : { volumeGal: galText((have ?? 0) - (partialGal ?? 0)), updatedAt: now })
            .where(eq(vesselFills.id, fill.id));
          return;
        }
        await tx.update(vesselFills).set({
          emptiedAt,
          outcome: body.outcome,
          notes: body.notes ? (fill.notes ? `${fill.notes}\n${body.notes}` : body.notes) : fill.notes,
          updatedAt: now,
        }).where(eq(vesselFills.id, fill.id));
      });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, "Couldn't record it");
    }
  });

  // Entered by mistake: take an open fill off the map. If it came from a move, the
  // batch goes back where it was.
  app.delete("/api/tank-map/fills/:id", isAuthenticated, isStaffOrAdmin, async (req, res) => {
    try {
      await db.transaction(async (tx) => {
        const [fill] = await tx.select().from(vesselFills).where(eq(vesselFills.id, req.params.id));
        if (!fill) throw new HttpError(404, "No such fill");
        if (fill.emptiedAt) throw new HttpError(409, "Only what is still in a vessel can be removed.");
        const children = await tx.select({ id: vesselFills.id }).from(vesselFills).where(eq(vesselFills.fromFillId, fill.id));
        if (children.length) throw new HttpError(409, "Part of this batch has already moved on or been packaged. Remove that first.");
        if (fill.fromFillId) {
          const [source] = await tx.select().from(vesselFills).where(eq(vesselFills.id, fill.fromFillId));
          if (source) {
            const now = new Date();
            if (source.emptiedAt && source.outcome === "moved") {
              await tx.update(vesselFills).set({ emptiedAt: null, outcome: null, updatedAt: now }).where(eq(vesselFills.id, source.id));
            } else if (!source.emptiedAt) {
              const back = fillGallons(fill);
              await tx.update(vesselFills)
                .set(source.kegs !== null
                  ? { kegs: source.kegs + Math.round(back / HALF_BBL_KEG_GALLONS), updatedAt: now }
                  : { volumeGal: galText((num(source.volumeGal) ?? 0) + back), updatedAt: now })
                .where(eq(vesselFills.id, source.id));
            }
          }
        }
        await tx.delete(vesselFills).where(eq(vesselFills.id, fill.id));
      });
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, "Couldn't remove it");
    }
  });

  // Rename a vessel or change its size: admin and up.
  app.patch("/api/tank-map/vessels/:id", isAuthenticated, isAdmin, async (req, res) => {
    const parsed = vesselUpdateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ message: firstIssue(parsed.error) });
    const body = parsed.data;
    try {
      const [vessel] = await db.select().from(vessels).where(eq(vessels.id, req.params.id));
      if (!vessel) throw new HttpError(404, "No such vessel");
      const patch: Partial<typeof vessels.$inferInsert> = {};
      if (body.name !== undefined) patch.name = body.name;
      if (body.capacityGal !== undefined) patch.capacityGal = vessel.kind === "fridge" ? null : galText(body.capacityGal);
      if (body.shape !== undefined) patch.shape = vessel.kind === "fridge" ? null : body.shape;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.isActive !== undefined) patch.isActive = body.isActive;
      if (Object.keys(patch).length) await db.update(vessels).set(patch).where(eq(vessels.id, vessel.id));
      res.json({ ok: true });
    } catch (e) {
      sendError(res, e, "Couldn't save the vessel");
    }
  });
}
