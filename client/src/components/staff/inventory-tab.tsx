import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Package, Plus, Loader2, History } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { Product, InventoryAdjustment } from "@shared/schema";

interface ProductionFormData {
  productId: string;
  quantity: number;
  batchNumber: string;
  productionDate: string;
  notes: string;
}

type InventoryAdjustmentWithProductName = InventoryAdjustment & { productName: string };

interface InventoryTabProps {
  products: Product[];
  isLoading: boolean;
}

export function InventoryTab({ products, isLoading }: InventoryTabProps) {
  const { toast } = useToast();
  const [productionDialogOpen, setProductionDialogOpen] = useState(false);
  const [productionForm, setProductionForm] = useState<ProductionFormData>({
    productId: '',
    quantity: 0,
    batchNumber: '',
    productionDate: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const { data: adjustments = [], isLoading: adjustmentsLoading } = useQuery<InventoryAdjustmentWithProductName[]>({
    queryKey: ['/api/inventory/adjustments'],
  });

  const recordProductionMutation = useMutation({
    mutationFn: async (data: ProductionFormData) => {
      return await apiRequest('POST', '/api/inventory/production', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      queryClient.invalidateQueries({ queryKey: ['/api/inventory/adjustments'] });
      setProductionDialogOpen(false);
      setProductionForm({
        productId: '',
        quantity: 0,
        batchNumber: '',
        productionDate: new Date().toISOString().split('T')[0],
        notes: '',
      });
      toast({
        title: "Production Recorded",
        description: "Inventory has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to record production",
        variant: "destructive",
      });
    },
  });

  const handleRecordProduction = () => {
    if (!productionForm.productId || productionForm.quantity <= 0) {
      toast({
        title: "Validation Error",
        description: "Please select a product and enter a positive quantity",
        variant: "destructive",
      });
      return;
    }

    recordProductionMutation.mutate(productionForm);
  };

  const getLowStockProducts = () => {
    return products.filter(p => p.stockQuantity <= p.lowStockThreshold);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Inventory Management</h2>
          <p className="text-sm text-muted-foreground">Track production and monitor stock levels</p>
        </div>
        <Dialog open={productionDialogOpen} onOpenChange={setProductionDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-record-production">
              <Plus className="w-4 h-4 mr-2" />
              Record Production
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Record Production Batch</DialogTitle>
              <DialogDescription>
                Add newly bottled or kegged inventory
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="product">Product</Label>
                <Select
                  value={productionForm.productId}
                  onValueChange={(value) => setProductionForm({ ...productionForm, productId: value })}
                >
                  <SelectTrigger id="product" data-testid="select-product">
                    <SelectValue placeholder="Select a product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id} data-testid={`option-product-${product.id}`}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="quantity">Quantity (cases)</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={productionForm.quantity || ''}
                  onChange={(e) => setProductionForm({ ...productionForm, quantity: parseInt(e.target.value) || 0 })}
                  data-testid="input-quantity"
                />
              </div>
              <div>
                <Label htmlFor="batchNumber">Batch Number (optional)</Label>
                <Input
                  id="batchNumber"
                  value={productionForm.batchNumber}
                  onChange={(e) => setProductionForm({ ...productionForm, batchNumber: e.target.value })}
                  placeholder="e.g., BATCH-2025-001"
                  data-testid="input-batch-number"
                />
              </div>
              <div>
                <Label htmlFor="productionDate">Production Date</Label>
                <Input
                  id="productionDate"
                  type="date"
                  value={productionForm.productionDate}
                  onChange={(e) => setProductionForm({ ...productionForm, productionDate: e.target.value })}
                  data-testid="input-production-date"
                />
              </div>
              <div>
                <Label htmlFor="notes">Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={productionForm.notes}
                  onChange={(e) => setProductionForm({ ...productionForm, notes: e.target.value })}
                  placeholder="Any additional notes about this batch..."
                  rows={3}
                  data-testid="input-notes"
                />
              </div>
              <Button
                className="w-full"
                onClick={handleRecordProduction}
                disabled={recordProductionMutation.isPending}
                data-testid="button-submit-production"
              >
                {recordProductionMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Recording...
                  </>
                ) : (
                  <>
                    <Package className="w-4 h-4 mr-2" />
                    Record Production
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {getLowStockProducts().length > 0 && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <Package className="w-5 h-5" />
              Low Stock Alert
            </CardTitle>
            <CardDescription>
              {getLowStockProducts().length} product(s) below threshold
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {getLowStockProducts().map((product) => (
                <div key={product.id} className="flex items-center justify-between">
                  <span className="font-medium">{product.name}</span>
                  <Badge variant="destructive">
                    {product.stockQuantity} cases (threshold: {product.lowStockThreshold})
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="text-xl font-semibold mb-4">Current Stock</h3>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading inventory...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card key={product.id} data-testid={`card-product-${product.id}`}>
                <CardHeader>
                  <CardTitle className="text-lg">{product.name}</CardTitle>
                  <CardDescription>{product.flavor}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Current Stock:</span>
                      <span className="font-bold text-xl" data-testid={`text-stock-${product.id}`}>
                        {product.stockQuantity} cases
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={product.inStock ? "default" : "destructive"}>
                        {product.inStock ? 'In Stock' : 'Out of Stock'}
                      </Badge>
                      {product.stockQuantity <= product.lowStockThreshold && (
                        <Badge variant="secondary">Low Stock</Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
          <History className="w-5 h-5" />
          Inventory Adjustments
        </h3>
        {adjustmentsLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading adjustments...</span>
          </div>
        ) : adjustments.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No inventory adjustments recorded yet
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b bg-muted/50">
                    <tr className="text-left">
                      <th className="p-4 font-semibold">Date</th>
                      <th className="p-4 font-semibold">Product</th>
                      <th className="p-4 font-semibold">Type</th>
                      <th className="p-4 font-semibold">Quantity</th>
                      <th className="p-4 font-semibold">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((adjustment) => {
                      const batchData = adjustment.batchMetadata ? JSON.parse(adjustment.batchMetadata) : null;
                      
                      return (
                        <tr key={adjustment.id} className="border-b last:border-0" data-testid={`row-adjustment-${adjustment.id}`}>
                          <td className="p-4 text-sm text-muted-foreground">
                            {format(new Date(adjustment.createdAt), 'MMM d, yyyy h:mm a')}
                          </td>
                          <td className="p-4 font-medium">{adjustment.productName}</td>
                          <td className="p-4">
                            <Badge variant={
                              adjustment.reason === 'production' ? 'default' :
                              adjustment.reason === 'fulfillment' ? 'secondary' :
                              'outline'
                            }>
                              {adjustment.reason}
                            </Badge>
                          </td>
                          <td className="p-4">
                            <span className={adjustment.quantity > 0 ? 'text-green-600 font-semibold' : 'text-red-600 font-semibold'}>
                              {adjustment.quantity > 0 ? '+' : ''}{adjustment.quantity} cases
                            </span>
                          </td>
                          <td className="p-4 text-sm text-muted-foreground">
                            {adjustment.reason === 'production' && batchData?.batchNumber && (
                              <div>Batch: {batchData.batchNumber}</div>
                            )}
                            {adjustment.notes && <div>{adjustment.notes}</div>}
                            {adjustment.orderId && (
                              <div>Order: {adjustment.orderType?.toUpperCase()}-{adjustment.orderId.slice(0, 8)}</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
