import type { RetailProduct, Flavor } from "@shared/schema";

/**
 * The flavor-first shop (owner, 2026-09-12): the grid leads with flavors and each
 * flavor page lists the PACKAGES it comes in. A "package" is an existing retail
 * product seen from one flavor's side — a single-flavor product whose flavorId
 * matches, or a multi-flavor product whose flavor list includes it. Nothing about
 * the data model changes; the cart still receives (retailProductId, selectedFlavorId).
 */

export type ShopFlavor = Flavor & { soldOut?: boolean };

export type ShopProduct = RetailProduct & {
  flavor: ShopFlavor | null;
  flavors: ShopFlavor[];
  /** Product-level flag the API sets on single-flavor bottle products whose stock is gone. */
  soldOut?: boolean;
};

export type FlavorPackage = {
  product: ShopProduct;
  /** false = this flavor is sold through in this package (bottle sell-through). */
  available: boolean;
  /** Short container word for "Available in" chips: Cans / Bottles / Kegs / fallback. */
  label: string;
};

// products.container is the canonical retail<->wholesale link ('bottle-case',
// 'can-…', 'keg-sixth'); older rows may be null, so fall back to the unit type.
export function containerLabel(p: RetailProduct): string {
  const c = (p as { container?: string | null }).container;
  if (c?.startsWith("can")) return "Cans";
  if (c === "bottle-case") return "Bottles";
  if (c?.startsWith("keg")) return "Kegs";
  const fallback = p.unitType.replace(/-/g, " ");
  return fallback.charAt(0).toUpperCase() + fallback.slice(1);
}

const LABEL_ORDER: Record<string, number> = { Cans: 0, Bottles: 1, Kegs: 2 };

export function packagesForFlavor(flavor: Flavor, products: ShopProduct[]): FlavorPackage[] {
  const out: FlavorPackage[] = [];
  for (const p of products) {
    if (!p.isActive) continue;
    if (p.productType === "single-flavor") {
      if (p.flavorId === flavor.id) {
        out.push({ product: p, available: !p.soldOut, label: containerLabel(p) });
      }
    } else {
      const link = p.flavors.find((f) => f.id === flavor.id);
      if (link) out.push({ product: p, available: !link.soldOut, label: containerLabel(p) });
    }
  }
  return out.sort(
    (a, b) =>
      (LABEL_ORDER[a.label] ?? 9) - (LABEL_ORDER[b.label] ?? 9) ||
      a.product.displayOrder - b.product.displayOrder,
  );
}

/** "Available in" chips for a flavor card: one per distinct package word, a chip
 * counting as available if ANY package under that word still is. */
export function availabilityChips(pkgs: FlavorPackage[]): Array<{ label: string; available: boolean }> {
  const byLabel = new Map<string, boolean>();
  for (const pkg of pkgs) {
    byLabel.set(pkg.label, (byLabel.get(pkg.label) ?? false) || pkg.available);
  }
  return Array.from(byLabel.entries()).map(([label, available]) => ({ label, available }));
}
