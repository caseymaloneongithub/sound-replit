import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ShoppingBag } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import type { Flavor, RetailProduct } from "@shared/schema";

export default function AdminRetailProducts() {
  const { toast } = useToast();
  const [editingRetailProduct, setEditingRetailProduct] = useState<string | null>(null);
  const [retailProductForm, setRetailProductForm] = useState({
    flavorId: '',
    unitType: '',
    unitDescription: '',
    price: 0,
    subscriptionDiscount: 10,
    isActive: true,
    displayOrder: 0
  });

  const { data: flavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });

  const { data: retailProducts = [], isLoading: retailProductsLoading } = useQuery<Array<RetailProduct & { flavor: Flavor }>>({
    queryKey: ['/api/retail-products'],
  });

  const createRetailProductMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        ...data,
        price: data.price.toFixed(2), // Serialize to string for decimal schema
        subscriptionDiscount: data.subscriptionDiscount.toFixed(2), // Serialize to string for decimal schema
      };
      return apiRequest('POST', '/api/retail-products', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail-products'] });
      setEditingRetailProduct(null);
      setRetailProductForm({ flavorId: '', unitType: '', unitDescription: '', price: 0, subscriptionDiscount: 10, isActive: true, displayOrder: 0 });
      toast({ title: "Retail product created", description: "Retail product has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create retail product", variant: "destructive" });
    },
  });

  const updateRetailProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const payload = {
        ...data,
        price: data.price.toFixed(2), // Serialize to string for decimal schema
        subscriptionDiscount: data.subscriptionDiscount.toFixed(2), // Serialize to string for decimal schema
      };
      return apiRequest('PATCH', `/api/retail-products/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail-products'] });
      setEditingRetailProduct(null);
      toast({ title: "Retail product updated", description: "Retail product has been updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update retail product", variant: "destructive" });
    },
  });

  const deleteRetailProductMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/retail-products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail-products'] });
      toast({ title: "Retail product deleted", description: "Retail product has been deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete retail product", variant: "destructive" });
    },
  });

  if (flavorsLoading || retailProductsLoading) {
    return (
      <StaffLayout>
        <div className="flex items-center justify-center min-h-96">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" data-testid="text-retail-products-title">Retail Product Offerings</h1>
          <p className="text-muted-foreground">
            Create specific products by combining flavors with unit types and setting retail prices
          </p>
        </div>

        <Card className="border-accent/30 mb-6">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-accent" />
                Retail Product Offerings
              </CardTitle>
              <CardDescription>Create specific products by combining flavors with unit types and setting retail prices</CardDescription>
            </div>
            <Dialog open={editingRetailProduct === 'new'} onOpenChange={(open) => !open && setEditingRetailProduct(null)}>
              <DialogTrigger asChild>
                <Button onClick={() => setEditingRetailProduct('new')} data-testid="button-create-retail-product">
                  Create Retail Product
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Retail Product</DialogTitle>
                  <DialogDescription>Add a flavor + unit combination</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <Label htmlFor="retail-flavor">Flavor</Label>
                    <Select
                      value={retailProductForm.flavorId}
                      onValueChange={(value) => setRetailProductForm({ ...retailProductForm, flavorId: value })}
                    >
                      <SelectTrigger data-testid="select-retail-flavor">
                        <SelectValue placeholder="Select a flavor" />
                      </SelectTrigger>
                      <SelectContent>
                        {flavors.map((flavor) => (
                          <SelectItem key={flavor.id} value={flavor.id}>
                            {flavor.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="retail-unit-type">Unit Type</Label>
                    <Input
                      id="retail-unit-type"
                      value={retailProductForm.unitType}
                      onChange={(e) => setRetailProductForm({ ...retailProductForm, unitType: e.target.value })}
                      placeholder="e.g., 6-pack, 12-pack, Single Bottle"
                      data-testid="input-retail-unit-type"
                    />
                  </div>
                  <div>
                    <Label htmlFor="retail-unit-description">Unit Description</Label>
                    <Input
                      id="retail-unit-description"
                      value={retailProductForm.unitDescription}
                      onChange={(e) => setRetailProductForm({ ...retailProductForm, unitDescription: e.target.value })}
                      placeholder="e.g., Six 16oz bottles"
                      data-testid="input-retail-unit-description"
                    />
                  </div>
                  <div>
                    <Label htmlFor="retail-price">Price</Label>
                    <Input
                      id="retail-price"
                      type="number"
                      step="0.01"
                      value={retailProductForm.price}
                      onChange={(e) => setRetailProductForm({ ...retailProductForm, price: parseFloat(e.target.value) || 0 })}
                      data-testid="input-retail-price"
                    />
                  </div>
                  <div>
                    <Label htmlFor="retail-subscription-discount">Subscription Discount (%)</Label>
                    <Input
                      id="retail-subscription-discount"
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={retailProductForm.subscriptionDiscount}
                      onChange={(e) => setRetailProductForm({ ...retailProductForm, subscriptionDiscount: parseFloat(e.target.value) || 0 })}
                      data-testid="input-retail-subscription-discount"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Percentage discount for subscribe & save (default: 10%)
                    </p>
                  </div>
                  <div>
                    <Label htmlFor="retail-display-order">Display Order</Label>
                    <Input
                      id="retail-display-order"
                      type="number"
                      value={retailProductForm.displayOrder}
                      onChange={(e) => setRetailProductForm({ ...retailProductForm, displayOrder: parseInt(e.target.value) || 0 })}
                      data-testid="input-retail-display-order"
                    />
                  </div>
                  <Button
                    onClick={() => createRetailProductMutation.mutate(retailProductForm)}
                    disabled={createRetailProductMutation.isPending}
                    className="w-full"
                    data-testid="button-save-retail-product"
                  >
                    {createRetailProductMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      'Create Retail Product'
                    )}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </CardHeader>
        </Card>

        {retailProductsLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading retail products...</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {retailProducts.map((product) => {
              return (
                <Card key={product.id} data-testid={`card-retail-product-${product.id}`} className="overflow-hidden">
                  {/* Flavor Image */}
                  {product.flavor.primaryImageUrl && (
                    <div className="w-full h-48 overflow-hidden bg-muted">
                      <img 
                        src={product.flavor.primaryImageUrl} 
                        alt={product.flavor.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <CardTitle>{product.flavor.name}</CardTitle>
                        <CardDescription>{product.unitType}</CardDescription>
                      </div>
                      <Badge variant={product.isActive ? "default" : "secondary"}>
                        {product.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Unit:</span>
                        <span className="font-semibold">{product.unitDescription}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Price:</span>
                        <span className="font-semibold text-lg">${Number(product.price).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Subscribe & Save:</span>
                        <span className="font-semibold text-accent">
                          {product.subscriptionDiscount !== null && product.subscriptionDiscount !== undefined 
                            ? `${Number(product.subscriptionDiscount).toFixed(0)}% off`
                            : '10% off'}
                        </span>
                      </div>
                      <div className="mt-4 pt-4 border-t">
                        <p className="text-xs text-muted-foreground">{product.flavor.description}</p>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="flex gap-2 flex-wrap">
                    <Dialog open={editingRetailProduct === product.id} onOpenChange={(open) => !open && setEditingRetailProduct(null)}>
                      <DialogTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setEditingRetailProduct(product.id);
                            setRetailProductForm({
                              flavorId: product.flavorId,
                              unitType: product.unitType,
                              unitDescription: product.unitDescription,
                              price: Number(product.price),
                              subscriptionDiscount: Number(product.subscriptionDiscount),
                              isActive: product.isActive,
                              displayOrder: product.displayOrder
                            });
                          }}
                          data-testid={`button-edit-retail-product-${product.id}`}
                        >
                          Edit
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                        <DialogHeader>
                          <DialogTitle>Edit Retail Product</DialogTitle>
                          <DialogDescription>Update product details</DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div>
                            <Label>Flavor</Label>
                            <Select
                              value={retailProductForm.flavorId}
                              onValueChange={(value) => setRetailProductForm({ ...retailProductForm, flavorId: value })}
                            >
                              <SelectTrigger data-testid="select-edit-retail-flavor">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {flavors.map((flavor) => (
                                  <SelectItem key={flavor.id} value={flavor.id}>
                                    {flavor.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Unit Type</Label>
                            <Input
                              value={retailProductForm.unitType}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, unitType: e.target.value })}
                              data-testid="input-edit-retail-unit-type"
                            />
                          </div>
                          <div>
                            <Label>Unit Description</Label>
                            <Input
                              value={retailProductForm.unitDescription}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, unitDescription: e.target.value })}
                              data-testid="input-edit-retail-unit-description"
                            />
                          </div>
                          <div>
                            <Label>Price</Label>
                            <Input
                              type="number"
                              step="0.01"
                              value={retailProductForm.price}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, price: parseFloat(e.target.value) || 0 })}
                              data-testid="input-edit-retail-price"
                            />
                          </div>
                          <div>
                            <Label>Subscription Discount (%)</Label>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              value={retailProductForm.subscriptionDiscount}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, subscriptionDiscount: parseFloat(e.target.value) || 0 })}
                              data-testid="input-edit-retail-subscription-discount"
                            />
                            <p className="text-xs text-muted-foreground mt-1">
                              Percentage discount for subscribe & save
                            </p>
                          </div>
                          <div>
                            <Label>Display Order</Label>
                            <Input
                              type="number"
                              value={retailProductForm.displayOrder}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, displayOrder: parseInt(e.target.value) || 0 })}
                              data-testid="input-edit-retail-display-order"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={retailProductForm.isActive}
                              onChange={(e) => setRetailProductForm({ ...retailProductForm, isActive: e.target.checked })}
                              data-testid="input-edit-retail-active"
                            />
                            <Label>Active</Label>
                          </div>
                          <Button
                            onClick={() => updateRetailProductMutation.mutate({ id: product.id, data: retailProductForm })}
                            disabled={updateRetailProductMutation.isPending}
                            className="w-full"
                            data-testid="button-update-retail-product"
                          >
                            {updateRetailProductMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              'Save Changes'
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                    <Button 
                      variant="destructive" 
                      size="sm"
                      onClick={() => {
                        if (confirm(`Delete retail product?`)) {
                          deleteRetailProductMutation.mutate(product.id);
                        }
                      }}
                      disabled={deleteRetailProductMutation.isPending}
                      data-testid={`button-delete-retail-product-${product.id}`}
                    >
                      Delete
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
