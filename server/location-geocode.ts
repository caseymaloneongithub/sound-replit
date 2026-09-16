/**
 * Geocoding for wholesale delivery locations — the one place that decides when a
 * location's pin is (re)computed and what gets written back.
 *
 * Owner, 2026-09-15: "You have Qualtrics and Fulcrum geocoded across the country."
 * Nine legacy stores (street only, no city/state/ZIP from the old import) had been
 * matched to Wisconsin, Ohio, New Jersey… and nothing could fix them: editing the
 * address kept the old coordinates, and Geocode All only visited rows with none.
 */
import type { InsertWholesaleLocation, WholesaleLocation } from "@shared/schema";
import { geocodeAddress } from "./mapbox-service";
import { storage } from "./storage";

const ADDRESS_PARTS = ["address", "city", "state", "zipCode"] as const;
type AddressPart = (typeof ADDRESS_PARTS)[number];

export type GeocodeWrite = Partial<InsertWholesaleLocation> & { geocodedAt?: Date | null };

const trimmed = (v: string | null | undefined) => (v ?? "").trim();

/** A pin computed from a street alone was a guess; it gets recomputed with the rest. */
export function addressIncomplete(loc: Pick<WholesaleLocation, "city" | "zipCode">): boolean {
  return !trimmed(loc.city) || !trimmed(loc.zipCode);
}

/**
 * Geocode `loc` and return the columns to write: coordinates plus any address part
 * the person left blank, filled from what Mapbox resolved (so a wrong match is
 * visible on screen, never silent). Never overwrites a part already entered.
 * Null result = Mapbox couldn't place it; callers clear the cached pin so the
 * stale one can't route a driver to the old address.
 */
export async function geocodeWriteFor(
  loc: Pick<WholesaleLocation, AddressPart>,
): Promise<GeocodeWrite | null> {
  const geo = await geocodeAddress(trimmed(loc.address), trimmed(loc.city), trimmed(loc.state), trimmed(loc.zipCode));
  if (!geo) return null;
  const write: GeocodeWrite = {
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    geocodedAt: new Date(),
  };
  if (!trimmed(loc.city) && geo.city) write.city = geo.city;
  if (!trimmed(loc.state) && geo.state) write.state = geo.state;
  if (!trimmed(loc.zipCode) && geo.zipCode) write.zipCode = geo.zipCode;
  return write;
}

export const CLEARED_PIN: GeocodeWrite = { latitude: null, longitude: null, geocodedAt: null };

/**
 * Columns to write alongside an edit so the pin follows the address. Returns {} when
 * no address part changed; the cleared pin when the new address can't be placed.
 */
export async function geocodeForEdit(
  existing: WholesaleLocation,
  updates: Partial<InsertWholesaleLocation>,
): Promise<GeocodeWrite> {
  const changed = ADDRESS_PARTS.some(
    (p) => updates[p] !== undefined && trimmed(updates[p]) !== trimmed(existing[p]),
  );
  if (!changed) return {};
  const next = Object.fromEntries(
    ADDRESS_PARTS.map((p) => [p, updates[p] !== undefined ? updates[p] : existing[p]]),
  ) as Record<AddressPart, string>;
  return (await geocodeWriteFor(next)) ?? CLEARED_PIN;
}

/** Geocode one stored location and persist the result. */
export async function refreshLocationPin(loc: WholesaleLocation): Promise<GeocodeWrite | null> {
  const write = await geocodeWriteFor(loc);
  if (write) await storage.updateWholesaleLocation(loc.id, write);
  return write;
}
