import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Product, ProductType, WholesaleCustomer, WholesalePricing, insertProductTypeSchema, InsertProductType } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { DollarSign, Loader2, Edit, X, Plus } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

export default function WholesaleProducts() {
  const [editingProductType, setEditingProductType] = useState<ProductType | null>(null);
  const [newWholesalePrice, setNewWholesalePrice] = useState("");
  const [customerPricingProductType, setCustomerPricingProductType] = useState<ProductType | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const { toast } = useToast();

  const createForm = useForm<InsertProductType>({
    resolver: zodResolver(insertProductTypeSchema),
    defaultValues: {
      name: "",
      description: "",
      retailPrice: "",
      wholesalePrice: "",
      unitType: "case",
      isActive: true,
    },
  });

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const { data: productTypes = [], isLoading: isLoadingProductTypes } = useQuery<ProductType[]>({
    queryKey: ["/api/product-types"],
  });

  const { data: customers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const { data: allPricing = [] } = useQuery<WholesalePricing[]>({
    queryKey: ["/api/wholesale/pricing/all"],
    queryFn: async () => {
      const response = await fetch("/api/wholesale/pricing/all");
      if (!response.ok) throw new Error("Failed to fetch pricing");
      return response.json();
    },
  });

  const updateWholesalePriceMutation = useMutation({
    mutationFn: async ({ id, wholesalePrice }: { id: string; wholesalePrice: string }) => {
      return await apiRequest("PATCH", `/api/product-types/${id}`, {
        wholesalePrice,
      });
    },
    onSuccess: () => {
      toast({
        title: "Price Updated",
        description: "Wholesale price has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-types"] });
      setEditingProductType(null);
      setNewWholesalePrice("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update wholesale price. Please try again.",
        variant: "destructive",
      });
    },
  });

  const setCustomerPricingMutation = useMutation({
    mutationFn: async () => {
      if (!customerPricingProductType || !selectedCustomer || !customPrice) {
        throw new Error("Missing required fields");
      }
      return await apiRequest("POST", "/api/wholesale/pricing", {
        customerId: selectedCustomer,
        productTypeId: customerPricingProductType.id,
        customPrice: parseFloat(customPrice),
      });
    },
    onSuccess: () => {
      toast({
        title: "Customer Pricing Set",
        description: "Customer-specific pricing has been set successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/pricing/all"] });
      setCustomerPricingProductType(null);
      setSelectedCustomer("");
      setCustomPrice("");
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to set customer pricing. Please try again.",
        variant: "destructive",
      });
    },
  });

  const createProductTypeMutation = useMutation({
    mutationFn: async (data: InsertProductType) => {
      return await apiRequest("POST", "/api/product-types", data);
    },
    onSuccess: () => {
      toast({
        title: "Product Type Created",
        description: "New product type has been created successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/product-types"] });
      setIsCreateDialogOpen(false);
      createForm.reset();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create product type. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleUpdateWholesalePrice = () => {
    if (!editingProductType || !newWholesalePrice) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid price.",
        variant: "destructive",
      });
      return;
    }

    const price = parseFloat(newWholesalePrice);
    if (isNaN(price) || price <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid positive price.",
        variant: "destructive",
      });
      return;
    }

    updateWholesalePriceMutation.mutate({
      id: editingProductType.id,
      wholesalePrice: newWholesalePrice,
    });
  };

  const handleSetCustomerPricing = () => {
    if (!selectedCustomer || !customPrice) {
      toast({
        title: "Validation Error",
        description: "Please select a customer and enter a price.",
        variant: "destructive",
      });
      return;
    }

    const price = parseFloat(customPrice);
    if (isNaN(price) || price <= 0) {
      toast({
        title: "Validation Error",
        description: "Please enter a valid positive price.",
        variant: "destructive",
      });
      return;
    }

    setCustomerPricingMutation.mutate();
  };

  const getCustomerPricingForProductType = (productTypeId: string) => {
    return allPricing.filter(p => p.productTypeId === productTypeId);
  };

  if (isLoading || isLoadingProductTypes) {
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
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Wholesale Pricing Management
          </h1>
          <p className="text-muted-foreground">
            Manage default wholesale prices and customer-specific pricing
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Product Wholesale Pricing</CardTitle>
                <CardDescription>Set default wholesale prices and manage customer-specific overrides</CardDescription>
              </div>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                data-testid="button-create-product-type"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Product Type
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Default Wholesale Price</TableHead>
                  <TableHead>Customer Overrides</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productTypes?.map((productType) => {
                  const customerPricing = getCustomerPricingForProductType(productType.id);
                  return (
                    <TableRow key={productType.id} data-testid={`row-product-type-${productType.id}`}>
                      <TableCell className="font-medium">{productType.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">${productType.wholesalePrice}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {customerPricing.length > 0 ? (
                          <Badge variant="secondary">
                            {customerPricing.length} custom {customerPricing.length === 1 ? 'price' : 'prices'}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingProductType(productType);
                              setNewWholesalePrice(productType.wholesalePrice);
                            }}
                            data-testid={`button-edit-price-${productType.id}`}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCustomerPricingProductType(productType)}
                            data-testid={`button-customer-pricing-${productType.id}`}
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Customer Pricing
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Edit Wholesale Price Dialog */}
        <Dialog open={!!editingProductType} onOpenChange={(open) => !open && setEditingProductType(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Wholesale Price</DialogTitle>
              <DialogDescription>
                Update the default wholesale price for {editingProductType?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="wholesale-price">Default Wholesale Price (per case)</Label>
                <Input
                  id="wholesale-price"
                  type="number"
                  step="0.01"
                  value={newWholesalePrice}
                  onChange={(e) => setNewWholesalePrice(e.target.value)}
                  data-testid="input-wholesale-price"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingProductType(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleUpdateWholesalePrice}
                disabled={updateWholesalePriceMutation.isPending}
                data-testid="button-save-price"
              >
                {updateWholesalePriceMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving...</>
                ) : (
                  "Save Price"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Customer Pricing Dialog */}
        <Dialog open={!!customerPricingProductType} onOpenChange={(open) => !open && setCustomerPricingProductType(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Customer-Specific Pricing</DialogTitle>
              <DialogDescription>
                Set custom wholesale prices for {customerPricingProductType?.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
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
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      data-testid="input-custom-price"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={handleSetCustomerPricing}
                      disabled={setCustomerPricingMutation.isPending}
                      data-testid="button-set-price"
                    >
                      {setCustomerPricingMutation.isPending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Setting...</>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          Set Price
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {customerPricingProductType && (
                <div>
                  <h4 className="font-semibold mb-3">Existing Customer Pricing</h4>
                  {getCustomerPricingForProductType(customerPricingProductType.id).length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Custom Price</TableHead>
                          <TableHead>vs. Default</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {getCustomerPricingForProductType(customerPricingProductType.id).map((pricing) => {
                          const customer = customers.find(c => c.id === pricing.customerId);
                          const difference = parseFloat(pricing.customPrice) - parseFloat(customerPricingProductType.wholesalePrice);
                          return (
                            <TableRow key={pricing.id}>
                              <TableCell>{customer?.businessName}</TableCell>
                              <TableCell className="font-semibold">${pricing.customPrice}</TableCell>
                              <TableCell>
                                <Badge variant={difference < 0 ? "destructive" : "secondary"}>
                                  {difference > 0 ? '+' : ''}{difference.toFixed(2)}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  ) : (
                    <p className="text-muted-foreground text-sm">No customer-specific pricing set for this product type.</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCustomerPricingProductType(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Product Type Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Product Type</DialogTitle>
              <DialogDescription>
                Add a new product type with retail and wholesale pricing
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit((data) => createProductTypeMutation.mutate(data))} className="space-y-4 py-4">
                <FormField
                  control={createForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Product Name</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., 12-pack Case" data-testid="input-product-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Product description..." data-testid="input-product-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={createForm.control}
                    name="retailPrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Retail Price (per case)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-retail-price" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={createForm.control}
                    name="wholesalePrice"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Wholesale Price (per case)</FormLabel>
                        <FormControl>
                          <Input {...field} type="number" step="0.01" placeholder="0.00" data-testid="input-wholesale-price-create" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={createForm.control}
                  name="unitType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-unit-type">
                            <SelectValue placeholder="Select unit type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="case">Case (12 bottles)</SelectItem>
                          <SelectItem value="1/6-barrel">1/6 Barrel (Sixth Barrel)</SelectItem>
                          <SelectItem value="1/2-barrel">1/2 Barrel (Half Barrel)</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createProductTypeMutation.isPending}
                    data-testid="button-submit-product-type"
                  >
                    {createProductTypeMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Creating...</>
                    ) : (
                      "Create Product Type"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
