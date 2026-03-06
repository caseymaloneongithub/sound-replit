import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Package, Plus, Edit, DollarSign, X, Upload, Image as ImageIcon, Power, PowerOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertProductSchema, type Product, type WholesaleCustomer, type WholesalePricing, type InsertProduct } from "@shared/schema";
import { z } from "zod";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { UploadResult } from "@uppy/core";
import { StaffLayout } from "@/components/staff/staff-layout";

const productFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  flavor: z.string().min(1, "Flavor is required"),
  ingredients: z.string().min(1, "Ingredients are required"),
  retailPrice: z.string(),
  wholesalePrice: z.string(),
  unitType: z.enum(["case", "1/6-barrel", "1/2-barrel"]).default("case"),
  inStock: z.boolean().default(true),
  stockQuantity: z.number(),
  lowStockThreshold: z.number(),
});

type ProductFormData = z.infer<typeof productFormSchema>;

interface PricingDialogProps {
  product: Product;
  customers: WholesaleCustomer[];
  onClose: () => void;
}

function PricingDialog({ product, customers, onClose }: PricingDialogProps) {
  const { toast } = useToast();
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  const pricingQueryConfig = useMemo(() => 
    customers.map(customer => ({
      queryKey: [`/api/wholesale/pricing/${customer.id}`],
      queryFn: async () => {
        const response = await fetch(`/api/wholesale/pricing/${customer.id}`);
        if (!response.ok) throw new Error('Failed to fetch pricing');
        return response.json() as Promise<WholesalePricing[]>;
      },
    })),
    [customers]
  );

  const pricingQueries = useQueries({
    queries: pricingQueryConfig,
  });

  const allPricing = pricingQueries.flatMap(q => q.data || []);
  const productPricing = allPricing.filter(p => p.productId === product.id);
  const isLoadingPricing = pricingQueries.some(q => q.isLoading);

  const setPricingMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/wholesale/pricing", {
        customerId: selectedCustomer,
        productId: product.id,
        customPrice: parseFloat(customPrice),
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Pricing Updated",
        description: "Customer-specific pricing has been set successfully.",
      });
      customers.forEach(customer => {
        queryClient.invalidateQueries({ queryKey: [`/api/wholesale/pricing/${customer.id}`] });
      });
      setSelectedCustomer("");
      setCustomPrice("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to set pricing. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSetPrice = () => {
    if (!selectedCustomer || !customPrice) {
      toast({
        title: "Validation Error",
        description: "Please select a customer and enter a price.",
        variant: "destructive",
      });
      return;
    }

    const priceValue = parseFloat(customPrice);
    if (isNaN(priceValue) || priceValue <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid positive price.",
        variant: "destructive",
      });
      return;
    }
    
    setPricingMutation.mutate();
  };

  return (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Customer-Specific Pricing</DialogTitle>
        <DialogDescription>
          Set custom wholesale prices for {product.name}
        </DialogDescription>
      </DialogHeader>
      
      {isLoadingPricing ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <span className="ml-2 text-muted-foreground">Loading pricing data...</span>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex gap-4">
            <div className="flex-1">
              <Label htmlFor="customer">Customer</Label>
              <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
                <SelectTrigger data-testid="select-pricing-customer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.businessName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-32">
              <Label htmlFor="price">Price</Label>
              <Input
                id="price"
                type="number"
                step="0.01"
               
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                data-testid="input-custom-price"
              />
            </div>
            <div className="flex items-end">
              <Button 
                onClick={handleSetPrice}
                disabled={setPricingMutation.isPending}
                data-testid="button-set-price"
              >
                {setPricingMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting...</>
                ) : (
                  "Set Price"
                )}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-3 bg-muted/50">
            <p className="text-sm font-medium mb-1">Default Wholesale Price</p>
            <p className="text-2xl font-bold">${product.wholesalePrice}</p>
          </div>
        </div>

          {productPricing.length > 0 && (
            <div>
              <h4 className="font-semibold mb-3">Custom Pricing</h4>
              <div className="space-y-2">
                {productPricing.map((pricing) => {
                  const customer = customers.find(c => c.id === pricing.customerId);
                  return (
                    <div 
                      key={pricing.id} 
                      className="flex items-center justify-between p-3 rounded-lg border"
                      data-testid={`pricing-${pricing.id}`}
                    >
                      <span className="font-medium">{customer?.businessName || 'Unknown Customer'}</span>
                      <span className="text-lg font-bold">${pricing.customPrice}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}

export default function AdminProducts() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [pricingProduct, setPricingProduct] = useState<Product | null>(null);
  const [uploadedPhotos, setUploadedPhotos] = useState<string[]>([]);
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products", { includeInactive: showInactive }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (showInactive) {
        params.append('includeInactive', 'true');
      }
      const response = await fetch(`/api/products?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch products');
      return response.json();
    },
  });

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const form = useForm<ProductFormData>({
    resolver: zodResolver(productFormSchema),
    defaultValues: {
      name: "",
      description: "",
      flavor: "",
      ingredients: "",
      retailPrice: "40.00",
      wholesalePrice: "30.00",
      unitType: "case",
      inStock: true,
      stockQuantity: 0,
      lowStockThreshold: 50,
    },
  });

  const createProductMutation = useMutation({
    mutationFn: async (data: InsertProduct) => {
      const response = await apiRequest("POST", "/api/products", data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Product Created",
        description: "New product has been added successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setIsAddDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create product. Please try again.",
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<InsertProduct> }) => {
      const response = await apiRequest("PATCH", `/api/products/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Product Updated",
        description: "Product has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
      form.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update product. Please try again.",
        variant: "destructive",
      });
    },
  });

  const toggleActivationMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return await apiRequest("PATCH", `/api/products/${id}`, { isActive });
    },
    onSuccess: (_, variables) => {
      toast({
        title: variables.isActive ? "Product Activated" : "Product Deactivated",
        description: `Product has been ${variables.isActive ? "activated" : "deactivated"} successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update product status. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (data: ProductFormData) => {
    if (uploadedPhotos.length === 0) {
      toast({
        title: "Validation Error",
        description: "Please upload at least one product photo.",
        variant: "destructive",
      });
      return;
    }

    const transformedData: InsertProduct = {
      ...data,
      ingredients: data.ingredients.split(',').map(s => s.trim()),
      imageUrls: uploadedPhotos,
      imageUrl: uploadedPhotos[0] || "",
    };
    
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: transformedData });
    } else {
      createProductMutation.mutate(transformedData);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setUploadedPhotos(product.imageUrls || (product.imageUrl ? [product.imageUrl] : []));
    form.reset({
      name: product.name,
      description: product.description,
      flavor: product.flavor,
      ingredients: product.ingredients.join(', '),
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
      unitType: (product.unitType as "case" | "1/6-barrel" | "1/2-barrel") || "case",
      inStock: product.inStock,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
    });
    setIsAddDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsAddDialogOpen(false);
    setEditingProduct(null);
    setUploadedPhotos([]);
    form.reset();
  };

  const handlePhotoUpload = async () => {
    try {
      const response = await fetch("/api/objects/upload", {
        method: "POST",
        credentials: "include",
      });
      
      if (!response.ok) throw new Error("Failed to get upload URL");
      
      const { uploadURL } = await response.json();
      return { method: "PUT" as const, url: uploadURL };
    } catch (error) {
      console.error("Error getting upload URL:", error);
      toast({
        title: "Upload Error",
        description: "Failed to prepare upload. Please try again.",
        variant: "destructive",
      });
      throw error;
    }
  };

  const handlePhotoUploadComplete = async (result: UploadResult<Record<string, unknown>, Record<string, unknown>>) => {
    try {
      setIsUploadingPhotos(true);
      const uploadedUrls = result.successful?.map((file: any) => file.uploadURL) || [];
      
      if (!uploadedUrls.length) {
        toast({
          title: "Upload Error",
          description: "No files were uploaded successfully.",
          variant: "destructive",
        });
        return;
      }

      const tempProductId = "new-product";
      const response = await apiRequest("PUT", `/api/products/${tempProductId}/photos`, {
        photoUrls: uploadedUrls
      });

      const result2 = await response.json();
      const newPaths = result2.imageUrls || [];
      
      setUploadedPhotos(prev => [...prev, ...newPaths]);
      
      toast({
        title: "Photos Uploaded",
        description: `${newPaths.length} photo(s) uploaded successfully.`,
      });
    } catch (error) {
      console.error("Error completing upload:", error);
      toast({
        title: "Upload Error",
        description: "Failed to complete upload. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsUploadingPhotos(false);
    }
  };

  const handleRemovePhoto = (photoUrl: string) => {
    setUploadedPhotos(prev => prev.filter(url => url !== photoUrl));
  };

  if (isLoading) {
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
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-products-title">Retail Product Management</h1>
            <p className="text-muted-foreground">Manage products, retail pricing, and inventory</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Switch 
                id="show-inactive" 
                checked={showInactive} 
                onCheckedChange={setShowInactive}
                data-testid="switch-show-inactive"
              />
              <Label htmlFor="show-inactive" className="cursor-pointer">
                Show Inactive Products
              </Label>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-product">
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          </div>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </DialogTitle>
                <DialogDescription>
                  {editingProduct ? 'Update product details and retail pricing' : 'Create a new product with retail pricing'}
                </DialogDescription>
              </DialogHeader>
              
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Name</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-product-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description</FormLabel>
                        <FormControl>
                          <Textarea 
                           
                            rows={3}
                            {...field}
                            data-testid="input-product-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="flavor"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Flavor Profile</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-product-flavor" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="ingredients"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ingredients (comma-separated)</FormLabel>
                        <FormControl>
                          <Textarea 
                           
                            rows={2}
                            {...field}
                            data-testid="input-product-ingredients"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="unitType"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Unit Type</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-unit-type">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="case">Case (12 bottles)</SelectItem>
                            <SelectItem value="1/6-barrel">1/6 Barrel Keg</SelectItem>
                            <SelectItem value="1/2-barrel">1/2 Barrel Keg</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="space-y-3">
                    <Label>Product Photos</Label>
                    <div className="flex flex-wrap gap-2">
                      {uploadedPhotos.map((photoUrl, index) => (
                        <div 
                          key={photoUrl} 
                          className="relative group w-24 h-24 rounded-md overflow-hidden border-2 border-border"
                          data-testid={`photo-${index}`}
                        >
                          <img 
                            src={photoUrl} 
                            alt={`Product photo ${index + 1}`}
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemovePhoto(photoUrl)}
                            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            data-testid={`button-remove-photo-${index}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <ObjectUploader
                      maxNumberOfFiles={5}
                      maxFileSize={5242880}
                      onGetUploadParameters={handlePhotoUpload}
                      onComplete={handlePhotoUploadComplete}
                    >
                      <Upload className="w-4 h-4 mr-2" />
                      {isUploadingPhotos ? "Uploading..." : "Add Photos"}
                    </ObjectUploader>
                    {uploadedPhotos.length === 0 && (
                      <p className="text-sm text-muted-foreground">At least one photo is required</p>
                    )}
                  </div>

                  <FormField
                    control={form.control}
                    name="retailPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Retail Price (per case)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" {...field} data-testid="input-retail-price" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="stockQuantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Stock Quantity</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value))} data-testid="input-stock-quantity" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="lowStockThreshold"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Low Stock Threshold</FormLabel>
                          <FormControl>
                            <Input type="number" {...field} onChange={e => field.onChange(parseInt(e.target.value))} data-testid="input-low-stock-threshold" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={handleCloseDialog}>
                      Cancel
                    </Button>
                    <Button 
                      type="submit" 
                      disabled={createProductMutation.isPending || updateProductMutation.isPending}
                      data-testid="button-submit-product"
                    >
                      {(createProductMutation.isPending || updateProductMutation.isPending) ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                      ) : (
                        editingProduct ? 'Update Product' : 'Create Product'
                      )}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              All Products
            </CardTitle>
            <CardDescription>
              Manage product details, pricing, and inventory levels
            </CardDescription>
          </CardHeader>
          <CardContent>
            {products && products.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Flavor</TableHead>
                    <TableHead>Retail Price/Case</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map((product) => (
                    <TableRow key={product.id} data-testid={`product-row-${product.id}`}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <img 
                            src={product.imageUrl} 
                            alt={product.name}
                            className="w-8 h-8 object-cover rounded"
                          />
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-muted-foreground capitalize">{product.unitType === 'case' ? 'Case (12 bottles)' : product.unitType}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{product.flavor}</TableCell>
                      <TableCell>${product.retailPrice}</TableCell>
                      <TableCell>
                        <span data-testid={`stock-${product.id}`}>{product.stockQuantity}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={product.inStock ? "default" : "destructive"}>
                            {product.inStock ? 'In Stock' : 'Out of Stock'}
                          </Badge>
                          <Badge variant={product.isActive ? "default" : "secondary"}>
                            {product.isActive ? 'Active' : 'Inactive'}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant={product.isActive ? "outline" : "default"}
                            onClick={() => toggleActivationMutation.mutate({ id: product.id, isActive: !product.isActive })}
                            disabled={toggleActivationMutation.isPending}
                            data-testid={`button-toggle-active-${product.id}`}
                            title={product.isActive ? "Deactivate Product" : "Activate Product"}
                          >
                            {product.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleEdit(product)}
                            data-testid={`button-edit-${product.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setPricingProduct(product)}
                            data-testid={`button-pricing-${product.id}`}
                          >
                            <DollarSign className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="text-center py-12">
                <Package className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-muted-foreground">No products found. Add your first product to get started.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {pricingProduct && (
        <Dialog open={!!pricingProduct} onOpenChange={() => setPricingProduct(null)}>
          <PricingDialog 
            product={pricingProduct} 
            customers={customers}
            onClose={() => setPricingProduct(null)}
          />
        </Dialog>
      )}
    </StaffLayout>
  );
}
