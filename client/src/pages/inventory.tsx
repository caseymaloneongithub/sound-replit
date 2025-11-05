import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Package, AlertTriangle, TrendingDown, Check } from "lucide-react";
import type { Product } from "@shared/schema";

export default function Inventory() {
  const { toast } = useToast();
  const [editingStock, setEditingStock] = useState<Record<string, number>>({});

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: lowStockProducts } = useQuery<Product[]>({
    queryKey: ["/api/inventory/low-stock"],
  });

  const updateStockMutation = useMutation({
    mutationFn: async ({ id, stockQuantity }: { id: string; stockQuantity: number }) => {
      return await apiRequest(`/api/inventory/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ stockQuantity }),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/inventory/low-stock"] });
      const newEditingStock = { ...editingStock };
      delete newEditingStock[id];
      setEditingStock(newEditingStock);
      toast({
        title: "Stock Updated",
        description: "Product inventory has been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update stock quantity. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleStockChange = (productId: string, value: string) => {
    const numValue = parseInt(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setEditingStock({ ...editingStock, [productId]: numValue });
    }
  };

  const handleSaveStock = (product: Product) => {
    const newStock = editingStock[product.id];
    if (newStock !== undefined) {
      updateStockMutation.mutate({ id: product.id, stockQuantity: newStock });
    }
  };

  const handleCancelEdit = (productId: string) => {
    const newEditingStock = { ...editingStock };
    delete newEditingStock[productId];
    setEditingStock(newEditingStock);
  };

  const getStockStatus = (product: Product) => {
    if (product.stockQuantity === 0) return { label: "Out of Stock", variant: "destructive" as const };
    if (product.stockQuantity <= product.lowStockThreshold) return { label: "Low Stock", variant: "secondary" as const };
    return { label: "In Stock", variant: "default" as const };
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const totalProducts = products?.length || 0;
  const lowStockCount = lowStockProducts?.length || 0;
  const outOfStockCount = products?.filter(p => p.stockQuantity === 0).length || 0;

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" data-testid="text-inventory-title">Inventory Management</h1>
          <p className="text-muted-foreground">Track and manage product stock levels</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card data-testid="card-total-products">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Total Products
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold" data-testid="text-total-count">
                {totalProducts}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Active SKUs</p>
            </CardContent>
          </Card>

          <Card data-testid="card-low-stock">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-yellow-600" />
                Low Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-yellow-600" data-testid="text-low-stock-count">
                {lowStockCount}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Needs restocking</p>
            </CardContent>
          </Card>

          <Card data-testid="card-out-of-stock">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-destructive" />
                Out of Stock
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold text-destructive" data-testid="text-out-of-stock-count">
                {outOfStockCount}
              </div>
              <p className="text-sm text-muted-foreground mt-1">Unavailable items</p>
            </CardContent>
          </Card>
        </div>

        {lowStockCount > 0 && (
          <Card className="mb-8 border-yellow-600/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                Low Stock Alert
              </CardTitle>
              <CardDescription>
                The following products are running low and may need restocking soon.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {lowStockProducts?.map((product) => (
                  <div
                    key={product.id}
                    className="flex items-center justify-between p-3 rounded-md bg-muted"
                    data-testid={`alert-product-${product.id}`}
                  >
                    <div>
                      <p className="font-medium">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Current: {product.stockQuantity} bottles | Threshold: {product.lowStockThreshold} bottles
                      </p>
                    </div>
                    <Badge variant={getStockStatus(product).variant}>
                      {getStockStatus(product).label}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>All Products</CardTitle>
            <CardDescription>View and update stock quantities for all products</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Flavor</TableHead>
                  <TableHead className="text-right">Current Stock</TableHead>
                  <TableHead className="text-right">Low Stock Alert</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products?.map((product) => {
                  const isEditing = editingStock[product.id] !== undefined;
                  const status = getStockStatus(product);

                  return (
                    <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="text-muted-foreground">{product.flavor}</TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            min="0"
                            value={editingStock[product.id]}
                            onChange={(e) => handleStockChange(product.id, e.target.value)}
                            className="w-24 text-right"
                            data-testid={`input-stock-${product.id}`}
                          />
                        ) : (
                          <span data-testid={`text-stock-${product.id}`}>{product.stockQuantity}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {product.lowStockThreshold}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} data-testid={`badge-status-${product.id}`}>
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              onClick={() => handleSaveStock(product)}
                              disabled={updateStockMutation.isPending}
                              data-testid={`button-save-${product.id}`}
                            >
                              {updateStockMutation.isPending ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <Check className="w-4 h-4" />
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancelEdit(product.id)}
                              data-testid={`button-cancel-${product.id}`}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingStock({ ...editingStock, [product.id]: product.stockQuantity })}
                            data-testid={`button-edit-${product.id}`}
                          >
                            Update Stock
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
