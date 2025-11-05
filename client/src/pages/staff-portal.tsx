import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/layout/navbar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Package, ShoppingCart, Settings, AlertCircle, Loader2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, WholesaleOrder, WholesaleCustomer } from "@shared/schema";

interface ProductFormData {
  name: string;
  description: string;
  flavor: string;
  abv: string;
  retailPrice: number;
  wholesalePrice: number;
  lowStockThreshold: number;
}

interface InventoryFormData {
  stockQuantity: number;
}

export default function StaffPortal() {
  const { toast } = useToast();
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductFormData>({
    name: '',
    description: '',
    flavor: '',
    abv: '',
    retailPrice: 0,
    wholesalePrice: 0,
    lowStockThreshold: 0,
  });
  const [inventoryForms, setInventoryForms] = useState<Record<string, InventoryFormData>>({});

  const { data: user, isLoading: userLoading, error: userError } = useQuery<any>({
    queryKey: ['/api/auth/user'],
    retry: false,
  });

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ['/api/products'],
  });

  const { data: orders = [], isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ['/api/wholesale/orders'],
  });

  const { data: customers = [], isLoading: customersLoading } = useQuery<WholesaleCustomer[]>({
    queryKey: ['/api/wholesale/customers'],
  });

  const updateOrderStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      return await apiRequest('PATCH', `/api/staff/orders/${orderId}/status`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wholesale/orders'] });
      toast({
        title: "Order updated",
        description: "Order status has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update order status",
        variant: "destructive",
      });
    },
  });

  const updateProductMutation = useMutation({
    mutationFn: async ({ productId, updates }: { productId: string; updates: any }) => {
      return await apiRequest('PATCH', `/api/staff/products/${productId}`, updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/products'] });
      setEditingProduct(null);
      toast({
        title: "Product updated",
        description: "Product has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update product",
        variant: "destructive",
      });
    },
  });

  const handleEditProduct = (product: Product) => {
    setEditingProduct(product.id);
    setProductForm({
      name: product.name,
      description: product.description,
      flavor: product.flavor,
      abv: product.abv,
      retailPrice: Number(product.retailPrice),
      wholesalePrice: Number(product.wholesalePrice),
      lowStockThreshold: product.lowStockThreshold,
    });
  };

  const handleSaveProduct = () => {
    if (!editingProduct) return;
    
    updateProductMutation.mutate({
      productId: editingProduct,
      updates: productForm,
    });
  };

  useEffect(() => {
    if (products.length > 0 && Object.keys(inventoryForms).length === 0) {
      const initialForms: Record<string, InventoryFormData> = {};
      products.forEach(product => {
        initialForms[product.id] = { stockQuantity: product.stockQuantity };
      });
      setInventoryForms(initialForms);
    }
  }, [products]);

  const handleUpdateInventory = (productId: string) => {
    const formData = inventoryForms[productId];
    if (!formData) return;
    
    updateProductMutation.mutate({
      productId,
      updates: { stockQuantity: formData.stockQuantity },
    });
  };

  if (userLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading...</span>
          </div>
        </div>
      </div>
    );
  }

  if (userError || !user || !user.isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-7xl mx-auto px-6 py-20">
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
              <CardTitle className="text-center">Access Denied</CardTitle>
              <CardDescription className="text-center">
                {userError ? "Please log in to access this page." : "You need admin privileges to access this page."}
              </CardDescription>
            </CardHeader>
            {userError && (
              <CardContent>
                <Button
                  onClick={() => window.location.href = '/api/login'}
                  className="w-full"
                  data-testid="button-login"
                >
                  Log In
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    );
  }

  const getCustomerName = (customerId: string) => {
    if (customersLoading) return 'Loading...';
    const customer = customers.find(c => c.id === customerId);
    return customer ? customer.businessName : 'Unknown Customer';
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Staff Portal
          </h1>
          <p className="text-muted-foreground">
            Manage orders, inventory, and product specifications
          </p>
        </div>

        <Tabs defaultValue="orders" className="space-y-6">
          <TabsList>
            <TabsTrigger value="orders" data-testid="tab-orders">
              <ShoppingCart className="w-4 h-4 mr-2" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-inventory">
              <Package className="w-4 h-4 mr-2" />
              Inventory
            </TabsTrigger>
            <TabsTrigger value="products" data-testid="tab-products">
              <Settings className="w-4 h-4 mr-2" />
              Product Specs
            </TabsTrigger>
          </TabsList>

          <TabsContent value="orders" className="space-y-4">
            {ordersLoading ? (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-muted-foreground">Loading orders...</span>
              </div>
            ) : orders.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <ShoppingCart className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">No orders found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <Card key={order.id} data-testid={`card-order-${order.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <CardTitle className="text-lg mb-1">
                            {getCustomerName(order.customerId)}
                          </CardTitle>
                          <CardDescription>
                            Order Date: {new Date(order.orderDate).toLocaleDateString()}
                          </CardDescription>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold mb-2">
                            ${Number(order.totalAmount).toFixed(2)}
                          </div>
                          <Select
                            value={order.status}
                            onValueChange={(status) => 
                              updateOrderStatusMutation.mutate({ orderId: order.id, status })
                            }
                            disabled={updateOrderStatusMutation.isPending}
                          >
                            <SelectTrigger className="w-[140px]" data-testid={`select-order-status-${order.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending" data-testid="status-pending">Pending</SelectItem>
                              <SelectItem value="processing" data-testid="status-processing">Processing</SelectItem>
                              <SelectItem value="shipped" data-testid="status-shipped">Shipped</SelectItem>
                              <SelectItem value="delivered" data-testid="status-delivered">Delivered</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </CardHeader>
                    {order.notes && (
                      <CardContent>
                        <p className="text-sm text-muted-foreground">
                          <strong>Notes:</strong> {order.notes}
                        </p>
                      </CardContent>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="inventory" className="space-y-4">
            {productsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-muted-foreground">Loading inventory...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {products.map((product) => {
                  const formData = inventoryForms[product.id];
                  
                  return (
                    <Card key={product.id} data-testid={`card-inventory-${product.id}`}>
                      <CardHeader>
                        <CardTitle className="text-lg">{product.name}</CardTitle>
                        <CardDescription>
                          Stock: {product.stockQuantity} bottles
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-4">
                          <div>
                            <Label>Update Stock Quantity</Label>
                            <div className="flex gap-2 mt-1">
                              <Input
                                type="number"
                                value={formData?.stockQuantity ?? product.stockQuantity}
                                onChange={(e) => {
                                  const value = parseInt(e.target.value) || 0;
                                  setInventoryForms(prev => ({
                                    ...prev,
                                    [product.id]: { stockQuantity: value },
                                  }));
                                }}
                                data-testid={`input-stock-${product.id}`}
                              />
                              <Button
                                onClick={() => handleUpdateInventory(product.id)}
                                disabled={updateProductMutation.isPending || formData?.stockQuantity === product.stockQuantity}
                                data-testid={`button-update-stock-${product.id}`}
                              >
                                {updateProductMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Update'}
                              </Button>
                            </div>
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
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            {productsLoading ? (
              <div className="flex items-center justify-center py-12 gap-2">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-muted-foreground">Loading products...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {products.map((product) => (
                  <Card key={product.id} data-testid={`card-product-${product.id}`}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <CardTitle>{product.name}</CardTitle>
                          <CardDescription>{product.flavor}</CardDescription>
                        </div>
                        <Dialog open={editingProduct === product.id} onOpenChange={(open) => !open && setEditingProduct(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => handleEditProduct(product)}
                              data-testid={`button-edit-product-${product.id}`}
                            >
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Edit {product.name}</DialogTitle>
                              <DialogDescription>
                                Update product specifications and pricing
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div>
                                <Label htmlFor="name">Product Name</Label>
                                <Input
                                  id="name"
                                  value={productForm.name}
                                  onChange={(e) => setProductForm({ ...productForm, name: e.target.value })}
                                  data-testid="input-product-name"
                                />
                              </div>
                              <div>
                                <Label htmlFor="description">Description</Label>
                                <Textarea
                                  id="description"
                                  value={productForm.description}
                                  onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}
                                  rows={4}
                                  data-testid="input-product-description"
                                />
                              </div>
                              <div>
                                <Label htmlFor="flavor">Flavor Profile</Label>
                                <Input
                                  id="flavor"
                                  value={productForm.flavor}
                                  onChange={(e) => setProductForm({ ...productForm, flavor: e.target.value })}
                                  data-testid="input-product-flavor"
                                />
                              </div>
                              <div>
                                <Label htmlFor="abv">ABV</Label>
                                <Input
                                  id="abv"
                                  value={productForm.abv}
                                  onChange={(e) => setProductForm({ ...productForm, abv: e.target.value })}
                                  data-testid="input-product-abv"
                                />
                              </div>
                              <div>
                                <Label htmlFor="retailPrice">Retail Price (per bottle)</Label>
                                <Input
                                  id="retailPrice"
                                  type="number"
                                  step="0.01"
                                  value={productForm.retailPrice}
                                  onChange={(e) => setProductForm({ ...productForm, retailPrice: parseFloat(e.target.value) || 0 })}
                                  data-testid="input-product-retail-price"
                                />
                              </div>
                              <div>
                                <Label htmlFor="wholesalePrice">Wholesale Price (per bottle)</Label>
                                <Input
                                  id="wholesalePrice"
                                  type="number"
                                  step="0.01"
                                  value={productForm.wholesalePrice}
                                  onChange={(e) => setProductForm({ ...productForm, wholesalePrice: parseFloat(e.target.value) || 0 })}
                                  data-testid="input-product-wholesale-price"
                                />
                              </div>
                              <div>
                                <Label htmlFor="lowStockThreshold">Low Stock Threshold</Label>
                                <Input
                                  id="lowStockThreshold"
                                  type="number"
                                  value={productForm.lowStockThreshold}
                                  onChange={(e) => setProductForm({ ...productForm, lowStockThreshold: parseInt(e.target.value) || 0 })}
                                  data-testid="input-product-threshold"
                                />
                              </div>
                              <Button
                                onClick={handleSaveProduct}
                                disabled={updateProductMutation.isPending}
                                className="w-full"
                                data-testid="button-save-product"
                              >
                                {updateProductMutation.isPending ? (
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
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Retail Price:</span>
                          <span className="font-semibold">${Number(product.retailPrice).toFixed(2)} / bottle</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Wholesale Price:</span>
                          <span className="font-semibold">${Number(product.wholesalePrice).toFixed(2)} / bottle</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">ABV:</span>
                          <span>{product.abv}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
