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
import { Loader2, Package, Plus, Edit, DollarSign, X } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { insertProductSchema, type Product, type WholesaleCustomer, type WholesalePricing, type InsertProduct } from "@shared/schema";
import { z } from "zod";

const productFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  flavor: z.string().min(1, "Flavor is required"),
  abv: z.string().min(1, "ABV is required"),
  ingredients: z.string().min(1, "Ingredients are required"),
  retailPrice: z.string(),
  wholesalePrice: z.string(),
  imageUrl: z.string().min(1, "Image URL is required"),
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
                  <SelectValue placeholder="Select customer..." />
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
                placeholder="0.00"
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

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
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
      abv: "",
      ingredients: "",
      retailPrice: "3.33",
      wholesalePrice: "2.50",
      imageUrl: "",
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

  const handleSubmit = (data: ProductFormData) => {
    const transformedData: InsertProduct = {
      ...data,
      ingredients: data.ingredients.split(',').map(s => s.trim()),
    };
    
    if (editingProduct) {
      updateProductMutation.mutate({ id: editingProduct.id, data: transformedData });
    } else {
      createProductMutation.mutate(transformedData);
    }
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    form.reset({
      name: product.name,
      description: product.description,
      flavor: product.flavor,
      abv: product.abv,
      ingredients: product.ingredients.join(', '),
      retailPrice: product.retailPrice,
      wholesalePrice: product.wholesalePrice,
      imageUrl: product.imageUrl,
      inStock: product.inStock,
      stockQuantity: product.stockQuantity,
      lowStockThreshold: product.lowStockThreshold,
    });
    setIsAddDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsAddDialogOpen(false);
    setEditingProduct(null);
    form.reset();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-products-title">Product Management</h1>
            <p className="text-muted-foreground">Manage products, pricing, and inventory</p>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-product">
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? 'Edit Product' : 'Add New Product'}
                </DialogTitle>
                <DialogDescription>
                  {editingProduct ? 'Update product details' : 'Create a new product for retail and wholesale'}
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
                          <Input placeholder="Island Hop" {...field} data-testid="input-product-name" />
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
                            placeholder="Describe this kombucha flavor..."
                            rows={3}
                            {...field}
                            data-testid="input-product-description"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="flavor"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Flavor Profile</FormLabel>
                          <FormControl>
                            <Input placeholder="hoppy tropical" {...field} data-testid="input-product-flavor" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="abv"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>ABV</FormLabel>
                          <FormControl>
                            <Input placeholder="0.5% ABV" {...field} data-testid="input-product-abv" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <FormField
                    control={form.control}
                    name="ingredients"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ingredients (comma-separated)</FormLabel>
                        <FormControl>
                          <Textarea 
                            placeholder="Organic green tea, Grapefruit, Cascade hops, Raw cane sugar, Live cultures"
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
                    name="imageUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Image URL</FormLabel>
                        <FormControl>
                          <Input placeholder="/products/ProductName.jpg" {...field} data-testid="input-product-image" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="retailPrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Retail Price</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="3.33" {...field} data-testid="input-retail-price" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="wholesalePrice"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Wholesale Price (Default)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" placeholder="2.50" {...field} data-testid="input-wholesale-price" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="stockQuantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Stock Quantity</FormLabel>
                          <FormControl>
                            <Input type="number" placeholder="150" {...field} onChange={e => field.onChange(parseInt(e.target.value))} data-testid="input-stock-quantity" />
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
                            <Input type="number" placeholder="50" {...field} onChange={e => field.onChange(parseInt(e.target.value))} data-testid="input-low-stock-threshold" />
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
        </div>

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
                    <TableHead>Retail Price</TableHead>
                    <TableHead>Wholesale Price</TableHead>
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
                            className="w-12 h-12 object-cover rounded"
                          />
                          <div>
                            <p className="font-medium">{product.name}</p>
                            <p className="text-sm text-muted-foreground">{product.abv}</p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{product.flavor}</TableCell>
                      <TableCell>${product.retailPrice}</TableCell>
                      <TableCell>${product.wholesalePrice}</TableCell>
                      <TableCell>
                        <span data-testid={`stock-${product.id}`}>{product.stockQuantity}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.inStock ? "default" : "destructive"}>
                          {product.inStock ? 'In Stock' : 'Out of Stock'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
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
    </div>
  );
}
