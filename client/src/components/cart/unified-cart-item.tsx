import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, Minus, Repeat } from "lucide-react";
import { formatCaseQuantity } from "@shared/pricing";
import type { UnifiedCartItem } from "@/hooks/use-unified-cart";

interface UnifiedCartItemProps {
  unifiedItem: UnifiedCartItem;
  onUpdateQuantity: (id: string, quantity: number, type: 'legacy' | 'retail_v2') => void;
  onRemove: (id: string, type: 'legacy' | 'retail_v2') => void;
  isUpdating: boolean;
}

export function UnifiedCartItemComponent({ unifiedItem, onUpdateQuantity, onRemove, isUpdating }: UnifiedCartItemProps) {
  const itemId = unifiedItem.item.id;
  const quantity = unifiedItem.item.quantity;
  const isSubscription = unifiedItem.item.isSubscription;
  const subscriptionFrequency = unifiedItem.item.subscriptionFrequency ?? undefined;
  
  // For retail_v2 items, handle multi-flavor products
  let productName: string;
  let productImageUrl: string;
  let unitDescription: string = 'case';
  
  if (unifiedItem.type === 'legacy') {
    productName = unifiedItem.item.product.name;
    productImageUrl = unifiedItem.item.product.imageUrl;
  } else {
    const item = unifiedItem.item;
    // Find the display flavor for multi-flavor products
    const displayFlavor = item.retailProduct.productType === 'multi-flavor' && item.selectedFlavorId
      ? item.retailProduct.flavors.find(f => f.id === item.selectedFlavorId)
      : item.retailProduct.flavor;
    
    productName = displayFlavor
      ? `${displayFlavor.name} ${item.retailProduct.unitDescription}`
      : item.retailProduct.unitDescription;
    
    productImageUrl = displayFlavor?.primaryImageUrl ?? '';
    unitDescription = item.retailProduct.unitDescription || 'case';
  }
    
  const basePrice = unifiedItem.type === 'legacy'
    ? unifiedItem.item.product.retailPrice
    : unifiedItem.item.retailProduct.price;

  const subscriptionDiscountPercentage = unifiedItem.type === 'retail_v2'
    ? parseFloat(unifiedItem.item.retailProduct.subscriptionDiscount)
    : 0;

  const pricePerCase = isSubscription && subscriptionDiscountPercentage > 0
    ? parseFloat(basePrice) * (1 - subscriptionDiscountPercentage / 100)
    : parseFloat(basePrice);

  return (
    <div
      className="flex gap-4 p-4 rounded-lg border"
      data-testid={`cart-item-${itemId}`}
    >
      <img
        src={productImageUrl}
        alt={productName}
        className="w-20 h-20 object-cover rounded"
      />
      <div className="flex-1 min-w-0">
        <h4 className="font-semibold truncate" data-testid={`text-item-name-${itemId}`}>
          {productName}
        </h4>
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {isSubscription && subscriptionDiscountPercentage > 0 ? (
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-primary" data-testid={`text-item-price-${itemId}`}>
                ${pricePerCase.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground line-through">
                ${parseFloat(basePrice).toFixed(2)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground" data-testid={`text-item-price-${itemId}`}>
              ${pricePerCase.toFixed(2)}
            </p>
          )}
          {isSubscription && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Repeat className="w-3 h-3" />
              {subscriptionFrequency === 'weekly' ? 'Weekly' :
               subscriptionFrequency === 'bi-weekly' ? 'Bi-Weekly' :
               subscriptionFrequency === 'every-4-weeks' ? 'Every 4 Weeks' :
               subscriptionFrequency === 'every-6-weeks' ? 'Every 6 Weeks' :
               'Every 8 Weeks'}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1 bg-muted rounded-full">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onUpdateQuantity(itemId, Math.max(1, quantity - 1), unifiedItem.type)}
            disabled={quantity <= 1 || isUpdating}
            data-testid={`button-decrease-${itemId}`}
          >
            <Minus className="w-3 h-3" />
          </Button>
          <span className="text-sm font-medium px-3 min-w-12 text-center" data-testid={`text-quantity-${itemId}`}>
            {quantity}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => onUpdateQuantity(itemId, quantity + 1, unifiedItem.type)}
            disabled={isUpdating}
            data-testid={`button-increase-${itemId}`}
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="text-right">
          <p className="font-bold" data-testid={`text-item-total-${itemId}`}>
            ${(pricePerCase * quantity).toFixed(2)}
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onRemove(itemId, unifiedItem.type)}
        data-testid={`button-remove-${itemId}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
