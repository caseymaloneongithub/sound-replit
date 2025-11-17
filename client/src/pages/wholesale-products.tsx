import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Product, WholesaleCustomer, WholesalePricing } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DollarSign, Loader2, Edit, X, Plus } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function WholesaleProducts() {
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newWholesalePrice, setNewWholesalePrice] = useState("");
  const [customerPricingProduct, setCustomerPricingProduct] = useState<Product | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const { toast } = useToast();

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
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
      return await apiRequest("PATCH", `/api/products/${id}`, {
        wholesalePrice,
      });
    },
    onSuccess: () => {
      toast({
        title: "Price Updated",
        description: "Wholesale price has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
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
      if (!customerPricingProduct || !selectedCustomer || !customPrice) {
        throw new Error("Missing required fields");
      }
      return await apiRequest("POST", "/api/wholesale/pricing", {
        customerId: selectedCustomer,
        productTypeId: customerPricingProduct.productTypeId,
        customPrice: parseFloat(customPrice),
      });
    },
    onSuccess: () => {
      toast({
        title: "Customer Pricing Set",
        description: "Customer-specific pricing has been set successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/pricing/all"] });
      setCustomerPricingProduct(null);
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

  const handleUpdateWholesalePrice = () => {
    if (!editingProduct || !newWholesalePrice) {
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
      id: editingProduct.id,
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

  const getCustomerPricingForProduct = (productId: string) => {
    return allPricing.filter(p => p.productId === productId);
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
            <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Product Wholesale Pricing</CardTitle>
            <CardDescription>Set default wholesale prices and manage customer-specific overrides</CardDescription>
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
                {products?.map((product) => {
                  const customerPricing = getCustomerPricingForProduct(product.id);
                  return (
                    <TableRow key={product.id} data-testid={`row-product-${product.id}`}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">${product.wholesalePrice}</span>
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
                              setEditingProduct(product);
                              setNewWholesalePrice(product.wholesalePrice);
                            }}
                            data-testid={`button-edit-price-${product.id}`}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit Price
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setCustomerPricingProduct(product)}
                            data-testid={`button-customer-pricing-${product.id}`}
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
        <Dialog open={!!editingProduct} onOpenChange={(open) => !open && setEditingProduct(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Wholesale Price</DialogTitle>
              <DialogDescription>
                Update the default wholesale price for {editingProduct?.name}
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
              <Button variant="outline" onClick={() => setEditingProduct(null)}>
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
        <Dialog open={!!customerPricingProduct} onOpenChange={(open) => !open && setCustomerPricingProduct(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Customer-Specific Pricing</DialogTitle>
              <DialogDescription>
                Set custom wholesale prices for {customerPricingProduct?.name}
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

              {customerPricingProduct && (
                <div>
                  <h4 className="font-semibold mb-3">Existing Customer Pricing</h4>
                  {getCustomerPricingForProduct(customerPricingProduct.id).length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Customer</TableHead>
                          <TableHead>Custom Price</TableHead>
                          <TableHead>vs. Default</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {getCustomerPricingForProduct(customerPricingProduct.id).map((pricing) => {
                          const customer = customers.find(c => c.id === pricing.customerId);
                          const difference = parseFloat(pricing.customPrice) - parseFloat(customerPricingProduct.wholesalePrice);
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
                    <p className="text-muted-foreground text-sm">No customer-specific pricing set for this product.</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCustomerPricingProduct(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
