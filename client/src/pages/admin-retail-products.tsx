import { useState, useRef } from "react";
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
import { Loader2, ShoppingBag, Upload, X } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import type { Flavor, RetailProduct } from "@shared/schema";

// Extended type for retail products with flavor data
type RetailProductWithFlavors = RetailProduct & {
  flavor: Flavor | null;
  flavors: Flavor[];
};

// Image Upload Component
function ImageUploadField({ 
  value, 
  onChange 
}: { 
  value: string; 
  onChange: (url: string) => void;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast({
        title: "Invalid file type",
        description: "Please select an image file",
        variant: "destructive"
      });
      return;
    }

    try {
      setUploading(true);

      const filename = `product-${Date.now()}-${file.name}`;
      
      // Get a signed upload URL from the backend
      const { uploadUrl } = await apiRequest('POST', '/api/object-storage/upload-url', {
        filename,
        directory: 'product-images'
      });

      // Upload the file to object storage
      const uploadResponse = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type,
        },
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload file');
      }

      // Use our local /public/ endpoint to serve the image
      const publicPath = `/public/product-images/${filename}`;

      onChange(publicPath);
      toast({
        title: "Image uploaded",
        description: "Product image has been uploaded successfully"
      });
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload image",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://... or upload below"
          data-testid="input-product-image-url"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          data-testid="button-upload-image"
        >
          {uploading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Upload className="w-4 h-4" />
          )}
        </Button>
        {value && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => onChange('')}
            data-testid="button-clear-image"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
      {value && (
        <div className="w-full h-32 rounded-md overflow-hidden bg-muted border">
          <img 
            src={value} 
            alt="Product preview" 
            className="w-full h-full object-contain"
          />
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Upload an image or paste a URL
      </p>
    </div>
  );
}

export default function AdminRetailProducts() {
  const { toast } = useToast();
  const [editingRetailProduct, setEditingRetailProduct] = useState<string | null>(null);
  const [retailProductForm, setRetailProductForm] = useState({
    productType: 'single-flavor' as 'single-flavor' | 'multi-flavor',
    productName: '',
    flavorId: '',
    selectedFlavorIds: [] as string[],
    unitType: '',
    unitDescription: '',
    price: 0,
    subscriptionDiscount: 10,
    productImageUrl: '',
    isActive: true,
    displayOrder: 0
  });

  const { data: flavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });

  const { data: retailProducts = [], isLoading: retailProductsLoading } = useQuery<RetailProductWithFlavors[]>({
    queryKey: ['/api/retail-products'],
  });

  const createRetailProductMutation = useMutation({
    mutationFn: async (data: any) => {
      // Safely serialize price and discount with proper defaults
      const price = typeof data.price === 'number' && !isNaN(data.price) ? data.price : 0;
      const subscriptionDiscount = typeof data.subscriptionDiscount === 'number' && !isNaN(data.subscriptionDiscount) 
        ? data.subscriptionDiscount 
        : 10;
      
      const payload = {
        productType: data.productType,
        productName: data.productType === 'multi-flavor' ? data.productName : null,
        flavorId: data.productType === 'single-flavor' ? data.flavorId : null,
        unitType: data.unitType,
        unitDescription: data.unitDescription,
        price: price.toFixed(2),
        subscriptionDiscount: subscriptionDiscount.toFixed(2),
        productImageUrl: data.productType === 'multi-flavor' ? data.productImageUrl : null,
        isActive: data.isActive,
        displayOrder: data.displayOrder,
      };
      const product = await apiRequest('POST', '/api/retail-products', payload);
      
      // If multi-flavor, set the flavor associations (including empty array)
      if (data.productType === 'multi-flavor' && Array.isArray(data.selectedFlavorIds)) {
        await apiRequest('POST', `/api/retail-products/${product.id}/flavors`, {
          flavorIds: data.selectedFlavorIds
        });
      }
      
      return product;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail-products'] });
      setEditingRetailProduct(null);
      setRetailProductForm({
        productType: 'single-flavor',
        productName: '',
        flavorId: '',
        selectedFlavorIds: [],
        unitType: '',
        unitDescription: '',
        price: 0,
        subscriptionDiscount: 10,
        productImageUrl: '',
        isActive: true,
        displayOrder: 0
      });
      toast({ title: "Retail product created", description: "Retail product has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create retail product", variant: "destructive" });
    },
  });

  const updateRetailProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      // Safely serialize price and discount with proper defaults
      const price = typeof data.price === 'number' && !isNaN(data.price) ? data.price : 0;
      const subscriptionDiscount = typeof data.subscriptionDiscount === 'number' && !isNaN(data.subscriptionDiscount) 
        ? data.subscriptionDiscount 
        : 10;
      
      const payload = {
        productType: data.productType,
        productName: data.productType === 'multi-flavor' ? data.productName : null,
        flavorId: data.productType === 'single-flavor' ? data.flavorId : null,
        unitType: data.unitType,
        unitDescription: data.unitDescription,
        price: price.toFixed(2),
        subscriptionDiscount: subscriptionDiscount.toFixed(2),
        productImageUrl: data.productType === 'multi-flavor' ? data.productImageUrl : null,
        isActive: data.isActive,
        displayOrder: data.displayOrder,
      };
      const product = await apiRequest('PATCH', `/api/retail-products/${id}`, payload);
      
      // If multi-flavor, always update the flavor associations (including empty array)
      if (data.productType === 'multi-flavor' && Array.isArray(data.selectedFlavorIds)) {
        await apiRequest('POST', `/api/retail-products/${id}/flavors`, {
          flavorIds: data.selectedFlavorIds
        });
      }
      
      return product;
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
                  <DialogDescription>
                    Create a single-flavor product or a multi-flavor product where customers choose their flavor
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  {/* Product Type Selector */}
                  <div>
                    <Label htmlFor="retail-product-type">Product Type</Label>
                    <Select
                      value={retailProductForm.productType}
                      onValueChange={(value: 'single-flavor' | 'multi-flavor') => 
                        setRetailProductForm({ ...retailProductForm, productType: value })
                      }
                    >
                      <SelectTrigger data-testid="select-product-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="single-flavor">Single Flavor</SelectItem>
                        <SelectItem value="multi-flavor">Multiple Flavors (Customer Chooses)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      {retailProductForm.productType === 'single-flavor'
                        ? 'Standard product with one flavor'
                        : 'Product where customer selects one flavor at checkout'}
                    </p>
                  </div>

                  {/* Product Name (multi-flavor only) */}
                  {retailProductForm.productType === 'multi-flavor' && (
                    <div>
                      <Label htmlFor="retail-product-name">Product Name</Label>
                      <Input
                        id="retail-product-name"
                        value={retailProductForm.productName}
                        onChange={(e) => setRetailProductForm({ ...retailProductForm, productName: e.target.value })}
                        placeholder="e.g., 12-Pack, Case, Mixed Case"
                        data-testid="input-product-name"
                      />
                    </div>
                  )}

                  {/* Single Flavor Selector */}
                  {retailProductForm.productType === 'single-flavor' && (
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
                  )}

                  {/* Multi-Flavor Checkbox List */}
                  {retailProductForm.productType === 'multi-flavor' && (
                    <div>
                      <Label>Select Flavors (Choose Multiple)</Label>
                      <div className="border rounded-md p-4 space-y-2 max-h-48 overflow-y-auto">
                        {flavors.map((flavor) => (
                          <label key={flavor.id} className="flex items-center gap-2 cursor-pointer hover-elevate p-2 rounded">
                            <input
                              type="checkbox"
                              checked={retailProductForm.selectedFlavorIds.includes(flavor.id)}
                              onChange={(e) => {
                                const newSelection = e.target.checked
                                  ? [...retailProductForm.selectedFlavorIds, flavor.id]
                                  : retailProductForm.selectedFlavorIds.filter(id => id !== flavor.id);
                                setRetailProductForm({ ...retailProductForm, selectedFlavorIds: newSelection });
                              }}
                              className="rounded"
                              data-testid={`checkbox-flavor-${flavor.id}`}
                            />
                            <span className="text-sm">{flavor.name}</span>
                          </label>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        Selected: {retailProductForm.selectedFlavorIds.length} flavor(s)
                      </p>
                    </div>
                  )}

                  {/* Product Image Upload (multi-flavor only) */}
                  {retailProductForm.productType === 'multi-flavor' && (
                    <div>
                      <Label htmlFor="retail-product-image">Product Image</Label>
                      <ImageUploadField
                        value={retailProductForm.productImageUrl}
                        onChange={(url) => setRetailProductForm({ ...retailProductForm, productImageUrl: url })}
                      />
                    </div>
                  )}
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
              const isMultiFlavor = product.productType === 'multi-flavor';
              const imageUrl = isMultiFlavor ? product.productImageUrl : product.flavor?.primaryImageUrl;
              const displayName = isMultiFlavor ? product.productName : product.flavor?.name;
              
              return (
                <Card key={product.id} data-testid={`card-retail-product-${product.id}`} className="overflow-hidden">
                  {/* Product Image */}
                  {imageUrl && (
                    <div className="w-full h-48 overflow-hidden bg-muted">
                      <img 
                        src={imageUrl} 
                        alt={displayName || 'Product'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  
                  <CardHeader>
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <CardTitle>{displayName}</CardTitle>
                        </div>
                        <CardDescription>{product.unitType}</CardDescription>
                      </div>
                      <Badge variant={product.isActive ? "default" : "secondary"}>
                        {product.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      {isMultiFlavor && product.flavors.length > 0 && (
                        <div className="mb-3">
                          <span className="text-muted-foreground text-xs">Flavor Options:</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {product.flavors.map((flavor) => (
                              <Badge key={flavor.id} variant="secondary" className="text-xs">
                                {flavor.name}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Unit:</span>
                        <span className="font-semibold">{product.unitDescription}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Price:</span>
                        <span className="font-semibold text-lg">${Number(product.price).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between gap-2">
                        <span className="text-muted-foreground">Subscribe & Save:</span>
                        <span className="font-semibold text-lg">
                          {product.subscriptionDiscount !== null && product.subscriptionDiscount !== undefined 
                            ? `${Number(product.subscriptionDiscount).toFixed(0)}% off`
                            : '10% off'}
                        </span>
                      </div>
                      {!isMultiFlavor && product.flavor && (
                        <div className="mt-4 pt-4 border-t">
                          <p className="text-xs text-muted-foreground">{product.flavor.description}</p>
                        </div>
                      )}
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
                              productType: (product.productType as 'single-flavor' | 'multi-flavor') || 'single-flavor',
                              productName: product.productName || '',
                              flavorId: product.flavorId || '',
                              selectedFlavorIds: product.flavors.map(f => f.id),
                              unitType: product.unitType,
                              unitDescription: product.unitDescription,
                              price: Number(product.price),
                              subscriptionDiscount: product.subscriptionDiscount != null ? Number(product.subscriptionDiscount) : 10,
                              productImageUrl: product.productImageUrl || '',
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
                          {/* Product Type Display (read-only for edit) */}
                          <div>
                            <Label>Product Type</Label>
                            <div className="text-sm text-muted-foreground mt-1">
                              {retailProductForm.productType === 'single-flavor' ? 'Single Flavor' : 'Multiple Flavors (Customer Chooses)'}
                            </div>
                          </div>

                          {/* Product Name (multi-flavor only) */}
                          {retailProductForm.productType === 'multi-flavor' && (
                            <div>
                              <Label htmlFor="edit-product-name">Product Name</Label>
                              <Input
                                id="edit-product-name"
                                value={retailProductForm.productName}
                                onChange={(e) => setRetailProductForm({ ...retailProductForm, productName: e.target.value })}
                                placeholder="e.g., 12-Pack, Case, Mixed Case"
                                data-testid="input-edit-product-name"
                              />
                            </div>
                          )}

                          {/* Single Flavor Selector */}
                          {retailProductForm.productType === 'single-flavor' && (
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
                          )}

                          {/* Multi-Flavor Checkbox List */}
                          {retailProductForm.productType === 'multi-flavor' && (
                            <div>
                              <Label>Select Flavors (Choose Multiple)</Label>
                              <div className="border rounded-md p-4 space-y-2 max-h-48 overflow-y-auto">
                                {flavors.map((flavor) => (
                                  <label key={flavor.id} className="flex items-center gap-2 cursor-pointer hover-elevate p-2 rounded">
                                    <input
                                      type="checkbox"
                                      checked={retailProductForm.selectedFlavorIds.includes(flavor.id)}
                                      onChange={(e) => {
                                        const newSelection = e.target.checked
                                          ? [...retailProductForm.selectedFlavorIds, flavor.id]
                                          : retailProductForm.selectedFlavorIds.filter(id => id !== flavor.id);
                                        setRetailProductForm({ ...retailProductForm, selectedFlavorIds: newSelection });
                                      }}
                                      className="rounded"
                                      data-testid={`checkbox-edit-flavor-${flavor.id}`}
                                    />
                                    <span className="text-sm">{flavor.name}</span>
                                  </label>
                                ))}
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                Selected: {retailProductForm.selectedFlavorIds.length} flavor(s)
                              </p>
                            </div>
                          )}

                          {/* Product Image Upload (multi-flavor only) */}
                          {retailProductForm.productType === 'multi-flavor' && (
                            <div>
                              <Label htmlFor="edit-product-image">Product Image</Label>
                              <ImageUploadField
                                value={retailProductForm.productImageUrl}
                                onChange={(url) => setRetailProductForm({ ...retailProductForm, productImageUrl: url })}
                              />
                            </div>
                          )}
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
