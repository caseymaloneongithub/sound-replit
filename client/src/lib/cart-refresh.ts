import type { QueryClient } from "@tanstack/react-query";

const RETAIL_CART = ["/api/retail-cart"] as const;

/**
 * Make the cached cart match the server before anything reads it as current.
 * Checkout does, and an out-of-date empty cart sends the customer back to the
 * shop with "Cart is empty" (review, 2026-09-23).
 *
 * Cancels any cart request already in flight first: while the cart has never
 * loaded, TanStack hands that same request back to a refetch, and one started
 * before the change answers with the old cart. Then reads the cart fresh.
 * Resolves false instead of throwing when that read fails, so a caller whose
 * change already succeeded can say so without doing it again.
 */
export async function reloadCart(queryClient: QueryClient): Promise<boolean> {
  try {
    await queryClient.cancelQueries({ queryKey: RETAIL_CART });
    await queryClient.fetchQuery({ queryKey: RETAIL_CART, staleTime: 0 });
    return true;
  } catch {
    return false;
  }
}
