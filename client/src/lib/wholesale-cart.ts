/**
 * Wholesale cart persistence, shared by the order form and the "Reorder" button.
 *
 * The cart used to be component-local state only, so a refresh or a stray back-button
 * wiped a half-built 20-line order. It is also the handoff channel for reorder: the
 * order-history page writes a cart here and navigates to the order form, which validates
 * it against the live catalogue on mount.
 *
 * Keyed by customer id so a shared browser (common at a shop counter) can't leak one
 * account's draft order into another's.
 */

export interface WholesaleCartItem {
  unitTypeId: string;
  flavorId: string;
  quantity: number;
}

const PREFIX = "wholesale-cart:";

function key(customerId: string) {
  return `${PREFIX}${customerId}`;
}

export function loadWholesaleCart(customerId: string | undefined): WholesaleCartItem[] {
  if (!customerId) return [];
  try {
    const raw = localStorage.getItem(key(customerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: this data survives deploys, so never trust its shape.
    return parsed.filter(
      (i: any) =>
        i &&
        typeof i.unitTypeId === "string" &&
        typeof i.flavorId === "string" &&
        Number.isFinite(i.quantity) &&
        i.quantity > 0,
    );
  } catch {
    return [];
  }
}

export function saveWholesaleCart(customerId: string | undefined, cart: WholesaleCartItem[]) {
  if (!customerId) return;
  try {
    if (cart.length === 0) localStorage.removeItem(key(customerId));
    else localStorage.setItem(key(customerId), JSON.stringify(cart));
  } catch {
    // Private browsing / quota — the cart still works in memory for this session.
  }
}

export function clearWholesaleCart(customerId: string | undefined) {
  saveWholesaleCart(customerId, []);
}
