import { useQuery } from "@tanstack/react-query";
import type { RetailCartItem, RetailProduct, Flavor } from "@shared/schema";

// Old cart item type
interface LegacyCartItem {
  id: string;
  productId: string;
  quantity: number;
  isSubscription: boolean;
  subscriptionFrequency?: string | null;
  product: {
    id: string;
    name: string;
    retailPrice: string;
    imageUrl: string;
  };
}

// New retail cart item type
type RetailCartItemWithProduct = RetailCartItem & {
  retailProduct: RetailProduct & { flavor: Flavor };
};

// Unified cart item with discriminator
export type UnifiedCartItem = 
  | { type: 'legacy'; item: LegacyCartItem }
  | { type: 'retail_v2'; item: RetailCartItemWithProduct };

export function useUnifiedCart() {
  const { data: legacyCart = [], isLoading: isLoadingLegacy } = useQuery<LegacyCartItem[]>({
    queryKey: ["/api/cart"],
  });

  const { data: retailCart = [], isLoading: isLoadingRetail } = useQuery<RetailCartItemWithProduct[]>({
    queryKey: ["/api/retail-cart"],
  });

  const unifiedItems: UnifiedCartItem[] = [
    ...legacyCart.map(item => ({ type: 'legacy' as const, item })),
    ...retailCart.map(item => ({ type: 'retail_v2' as const, item })),
  ];

  return {
    items: unifiedItems,
    isLoading: isLoadingLegacy || isLoadingRetail,
    legacyCount: legacyCart.length,
    retailCount: retailCart.length,
    totalCount: unifiedItems.length,
  };
}
