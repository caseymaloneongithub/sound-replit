import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Package, ShoppingCart, Settings, AlertCircle, Loader2, Users } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Product, WholesaleOrder, WholesaleCustomer, User } from "@shared/schema";

interface ProductFormData {
  name: string;
  description: string;
  flavor: string;
  retailPrice: number;
  wholesalePrice: number;
  lowStockThreshold: number;
}

interface InventoryFormData {
  stockQuantity: number;
}

export default function StaffPortal() {
  const { toast } = useToast();
  
  // Read tab from URL query parameter using wouter's useSearch hook
  const searchString = useSearch();
  const urlParams = new URLSearchParams(searchString);
  const tabFromUrl = urlParams.get('tab') || 'orders';
  const [activeTab, setActiveTab] = useState(tabFromUrl);
  
  // Update tab when URL search params change
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const tab = params.get('tab') || 'orders';
    setActiveTab(tab);
  }, [searchString]);
  
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<ProductFormData>({
    name: '',
    description: '',
    flavor: '',
    retailPrice: 0,
    wholesalePrice: 0,
    lowStockThreshold: 0,
  });
  const [inventoryForms, setInventoryForms] = useState<Record<string, InventoryFormData>>({});

  const { data: user, isLoading: userLoading, error: userError } = useQuery<any>({
    queryKey: ['/api/user'],
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

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/staff/users'],
    enabled: user?.role === 'super_admin',
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

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest('PATCH', `/api/staff/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff/users'] });
      toast({
        title: "User role updated",
        description: "User role has been updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update user role",
        variant: "destructive",
      });
    },
  });

  const [backfillResults, setBackfillResults] = useState<any>(null);

  const backfillStripeCustomersMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      return await apiRequest('POST', '/api/admin/backfill-stripe-customers', { dryRun });
    },
    onSuccess: (data) => {
      setBackfillResults(data);
      if (!data.dryRun) {
        queryClient.invalidateQueries({ queryKey: ['/api/staff/users'] });
      }
      toast({
        title: data.dryRun ? "Dry Run Complete" : "Backfill Complete",
        description: data.message,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to backfill Stripe customers",
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

  const hasStaffAccess = user && (user.isAdmin || user.role === 'staff');

  if (userLoading) {
    return (
      <StaffLayout>
        <div className="max-w-7xl mx-auto px-6 py-20">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading...</span>
          </div>
        </div>
      </StaffLayout>
    );
  }

  if (userError || !user || !hasStaffAccess) {
    return (
      <StaffLayout>
        <div className="max-w-7xl mx-auto px-6 py-20">
          <Card className="max-w-md mx-auto">
            <CardHeader>
              <AlertCircle className="w-12 h-12 mx-auto mb-4 text-destructive" />
              <CardTitle className="text-center">Access Denied</CardTitle>
              <CardDescription className="text-center">
                {userError ? "Please log in to access this page." : "You need staff or admin privileges to access this page."}
              </CardDescription>
            </CardHeader>
            {userError && (
              <CardContent>
                <Button
                  onClick={() => window.location.href = '/auth'}
                  className="w-full"
                  data-testid="button-login"
                >
                  Log In
                </Button>
              </CardContent>
            )}
          </Card>
        </div>
      </StaffLayout>
    );
  }

  const getCustomerName = (customerId: string) => {
    if (customersLoading) return 'Loading...';
    const customer = customers.find(c => c.id === customerId);
    return customer ? customer.businessName : 'Unknown Customer';
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            Staff Portal
          </h1>
          <p className="text-muted-foreground">
            Manage orders, inventory, and product specifications
          </p>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList>
            <TabsTrigger value="orders" data-testid="tab-orders">
              <ShoppingCart className="w-4 h-4 mr-2" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="inventory" data-testid="tab-inventory">
              <Package className="w-4 h-4 mr-2" />
              Inventory
            </TabsTrigger>
            {user?.isAdmin && (
              <TabsTrigger value="products" data-testid="tab-products">
                <Settings className="w-4 h-4 mr-2" />
                Product Specs
              </TabsTrigger>
            )}
            {user?.role === 'super_admin' && (
              <TabsTrigger value="users" data-testid="tab-users">
                <Users className="w-4 h-4 mr-2" />
                User Management
              </TabsTrigger>
            )}
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

          {user?.isAdmin && (
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
                                <Label htmlFor="retailPrice">Retail Price (per case)</Label>
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
                                <Label htmlFor="wholesalePrice">Wholesale Price (per case)</Label>
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
                          <span className="font-semibold">${Number(product.retailPrice).toFixed(2)} / case</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Wholesale Price:</span>
                          <span className="font-semibold">${Number(product.wholesalePrice).toFixed(2)} / case</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
          )}

          {user?.role === 'super_admin' && (
            <TabsContent value="users" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Stripe Customer Sync</CardTitle>
                  <CardDescription>
                    Create Stripe customer records for retail and wholesale customers who don't have them yet
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        onClick={() => backfillStripeCustomersMutation.mutate({ dryRun: true })}
                        variant="outline"
                        disabled={backfillStripeCustomersMutation.isPending}
                        data-testid="button-stripe-dry-run"
                      >
                        {backfillStripeCustomersMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Processing...
                          </>
                        ) : (
                          'Preview (Dry Run)'
                        )}
                      </Button>
                      <Button
                        onClick={() => backfillStripeCustomersMutation.mutate({ dryRun: false })}
                        disabled={backfillStripeCustomersMutation.isPending}
                        data-testid="button-stripe-backfill"
                      >
                        {backfillStripeCustomersMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin mr-2" />
                            Processing...
                          </>
                        ) : (
                          'Sync to Stripe'
                        )}
                      </Button>
                    </div>
                    
                    {backfillResults && (
                      <div className="p-3 border rounded-md bg-muted/50">
                        <p className="font-semibold mb-2">
                          {backfillResults.dryRun ? 'Dry Run Results:' : 'Backfill Results:'}
                        </p>
                        <div className="text-sm space-y-1">
                          <p>Total users: {backfillResults.total}</p>
                          {!backfillResults.dryRun && (
                            <>
                              <p className="text-green-600">Successful: {backfillResults.successful}</p>
                              <p className="text-red-600">Failed: {backfillResults.failed}</p>
                            </>
                          )}
                          {backfillResults.errors && backfillResults.errors.length > 0 && (
                            <div className="mt-2">
                              <p className="font-semibold text-red-600">Errors:</p>
                              {backfillResults.errors.map((err: any, idx: number) => (
                                <p key={idx} className="text-xs text-red-600">
                                  {err.username}: {err.error}
                                </p>
                              ))}
                            </div>
                          )}
                          {backfillResults.users && backfillResults.users.length > 0 && (
                            <div className="mt-2">
                              <p className="font-semibold">Users to sync:</p>
                              {backfillResults.users.map((u: any, idx: number) => (
                                <p key={idx} className="text-xs">
                                  {u.username} ({u.email}) - {u.role}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              {usersLoading ? (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-muted-foreground">Loading users...</span>
                </div>
              ) : allUsers.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Users className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                    <p className="text-muted-foreground">No users found</p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {allUsers.map((u) => (
                    <Card key={u.id} data-testid={`card-user-${u.id}`}>
                      <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                          <span className="text-lg">
                            {u.firstName} {u.lastName}
                          </span>
                          <Badge 
                            variant={u.role === 'super_admin' ? 'default' : u.role === 'admin' ? 'secondary' : 'outline'}
                            data-testid={`badge-role-${u.id}`}
                          >
                            {u.role === 'super_admin' ? 'Super Admin' : u.role === 'admin' ? 'Admin' : u.role === 'staff' ? 'Staff' : 'User'}
                          </Badge>
                        </CardTitle>
                        <CardDescription data-testid={`text-email-${u.id}`}>
                          {u.email}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <Label htmlFor={`role-${u.id}`}>Role</Label>
                          <Select
                            value={u.role}
                            onValueChange={(role) => {
                              if (u.id !== user?.id) {
                                updateUserRoleMutation.mutate({ userId: u.id, role });
                              }
                            }}
                            disabled={u.id === user?.id || updateUserRoleMutation.isPending}
                          >
                            <SelectTrigger id={`role-${u.id}`} data-testid={`select-role-${u.id}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user" data-testid={`option-user-${u.id}`}>User</SelectItem>
                              <SelectItem value="admin" data-testid={`option-admin-${u.id}`}>Admin</SelectItem>
                              <SelectItem value="super_admin" data-testid={`option-super-admin-${u.id}`}>Super Admin</SelectItem>
                            </SelectContent>
                          </Select>
                          {u.id === user?.id && (
                            <p className="text-xs text-muted-foreground">
                              You cannot change your own role
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          )}
        </Tabs>
      </div>
    </StaffLayout>
  );
}
