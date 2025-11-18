import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useSearch } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Package, ShoppingCart, Settings, AlertCircle, Loader2, Users, Eye, Building2, Palette, ShoppingBag, Box } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { InventoryTab } from "@/components/staff/inventory-tab";
import CRMPage from "@/pages/crm-page";
import type { Product, WholesaleOrder, WholesaleCustomer, User, Flavor, RetailProduct, WholesaleUnitType } from "@shared/schema";
import { insertFlavorSchema, insertRetailProductSchema, insertWholesaleUnitTypeSchema } from "@shared/schema";

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

type UserWithImpersonation = User & {
  impersonation?: {
    isImpersonating: boolean;
    originalUser: {
      id: string;
      username: string;
    };
  };
};

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
  
  // New schema management state
  const [editingFlavor, setEditingFlavor] = useState<string | null>(null);
  const [flavorForm, setFlavorForm] = useState({
    name: '',
    description: '',
    flavorProfile: '',
    ingredients: [] as string[],
    imageUrl: '',
    isActive: true,
    displayOrder: 0
  });
  
  const [editingRetailProduct, setEditingRetailProduct] = useState<string | null>(null);
  const [retailProductForm, setRetailProductForm] = useState({
    flavorId: '',
    unitType: '',
    unitDescription: '',
    price: 0,
    isActive: true,
    displayOrder: 0
  });
  
  const [editingWholesaleUnitType, setEditingWholesaleUnitType] = useState<string | null>(null);
  const [wholesaleUnitTypeForm, setWholesaleUnitTypeForm] = useState({
    name: '',
    unitType: '',
    description: '',
    defaultPrice: 0,
    availableFlavors: [] as string[],
    isActive: true,
    displayOrder: 0
  });

  const { data: user, isLoading: userLoading, error: userError } = useQuery<UserWithImpersonation>({
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
  
  // New schema queries
  const { data: flavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });
  
  const { data: retailProducts = [], isLoading: retailProductsLoading } = useQuery<RetailProduct[]>({
    queryKey: ['/api/retail-products'],
  });
  
  const { data: wholesaleUnitTypes = [], isLoading: wholesaleUnitTypesLoading } = useQuery<WholesaleUnitType[]>({
    queryKey: ['/api/wholesale-unit-types'],
    enabled: user?.role === 'staff' || user?.role === 'admin' || user?.role === 'super_admin',
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

  const impersonateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch('/api/impersonate/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to impersonate user');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      window.location.href = '/shop';
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to impersonate user",
        variant: "destructive",
      });
    },
  });
  
  // NEW SCHEMA - Flavor mutations
  const createFlavorMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('POST', '/api/flavors', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flavors'] });
      setEditingFlavor(null);
      setFlavorForm({ name: '', description: '', flavorProfile: '', ingredients: [], imageUrl: '', isActive: true, displayOrder: 0 });
      toast({ title: "Flavor created", description: "Flavor has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create flavor", variant: "destructive" });
    },
  });
  
  const updateFlavorMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest('PATCH', `/api/flavors/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flavors'] });
      setEditingFlavor(null);
      toast({ title: "Flavor updated", description: "Flavor has been updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update flavor", variant: "destructive" });
    },
  });
  
  const deleteFlavorMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/flavors/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flavors'] });
      toast({ title: "Flavor deleted", description: "Flavor has been deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete flavor", variant: "destructive" });
    },
  });
  
  // NEW SCHEMA - Retail Product mutations
  const createRetailProductMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('POST', '/api/retail-products', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail-products'] });
      setEditingRetailProduct(null);
      setRetailProductForm({ flavorId: '', unitType: '', unitDescription: '', price: 0, isActive: true, displayOrder: 0 });
      toast({ title: "Retail product created", description: "Retail product has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create retail product", variant: "destructive" });
    },
  });
  
  const updateRetailProductMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest('PATCH', `/api/retail-products/${id}`, data),
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
  
  // NEW SCHEMA - Wholesale Unit Type mutations
  const createWholesaleUnitTypeMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('POST', '/api/wholesale-unit-types', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wholesale-unit-types'] });
      setEditingWholesaleUnitType(null);
      setWholesaleUnitTypeForm({ name: '', unitType: '', description: '', defaultPrice: 0, availableFlavors: [], isActive: true, displayOrder: 0 });
      toast({ title: "Wholesale unit type created", description: "Wholesale unit type has been created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create wholesale unit type", variant: "destructive" });
    },
  });
  
  const updateWholesaleUnitTypeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest('PATCH', `/api/wholesale-unit-types/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wholesale-unit-types'] });
      setEditingWholesaleUnitType(null);
      toast({ title: "Wholesale unit type updated", description: "Wholesale unit type has been updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update wholesale unit type", variant: "destructive" });
    },
  });
  
  const deleteWholesaleUnitTypeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest('DELETE', `/api/wholesale-unit-types/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wholesale-unit-types'] });
      toast({ title: "Wholesale unit type deleted", description: "Wholesale unit type has been deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete wholesale unit type", variant: "destructive" });
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
            <TabsTrigger value="crm" data-testid="tab-crm">
              <Building2 className="w-4 h-4 mr-2" />
              CRM
            </TabsTrigger>
            {user?.isAdmin && (
              <TabsTrigger value="products" data-testid="tab-products">
                <Settings className="w-4 h-4 mr-2" />
                Product Specs (Legacy)
              </TabsTrigger>
            )}
            {user?.isAdmin && (
              <TabsTrigger value="flavors" data-testid="tab-flavors">
                <Palette className="w-4 h-4 mr-2" />
                Flavors
              </TabsTrigger>
            )}
            {user?.isAdmin && (
              <TabsTrigger value="retail-products" data-testid="tab-retail-products">
                <ShoppingBag className="w-4 h-4 mr-2" />
                Retail Products
              </TabsTrigger>
            )}
            {user?.isAdmin && (
              <TabsTrigger value="wholesale-units" data-testid="tab-wholesale-units">
                <Box className="w-4 h-4 mr-2" />
                Wholesale Units
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
            <InventoryTab products={products} isLoading={productsLoading} />
          </TabsContent>

          <TabsContent value="crm" className="space-y-4">
            <CRMPage />
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
                    Create Stripe customer records for retail customers who don't have them yet
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
                      <CardFooter>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => impersonateMutation.mutate(u.id)}
                          disabled={
                            u.id === user?.id ||
                            user?.impersonation?.isImpersonating ||
                            impersonateMutation.isPending
                          }
                          data-testid={`button-impersonate-${u.id}`}
                          className="w-full"
                        >
                          <Eye className="w-4 h-4 mr-2" />
                          {impersonateMutation.isPending ? "Impersonating..." : "Impersonate"}
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          )}
          
          {/* NEW SCHEMA - Overview Card (shown at top of all new schema tabs) */}
          {user?.isAdmin && (activeTab === 'flavors' || activeTab === 'retail-products' || activeTab === 'wholesale-units') && (
            <Card className="bg-primary/5 border-primary/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-5 h-5" />
                  New Product Management System
                </CardTitle>
                <CardDescription className="space-y-2">
                  <p className="font-medium">This is the new flavor-centric product management system with three interconnected parts:</p>
                  <div className="grid gap-2 mt-2">
                    <div className="flex items-start gap-2">
                      <Palette className="w-4 h-4 mt-0.5 text-primary" />
                      <div>
                        <strong className="text-foreground">Flavors (Central Library)</strong> - Master list of all kombucha flavors used by BOTH retail and wholesale
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <ShoppingBag className="w-4 h-4 mt-0.5 text-accent" />
                      <div>
                        <strong className="text-foreground">Retail Products</strong> - Combines flavors with unit types (case, keg) and individual retail pricing
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <Box className="w-4 h-4 mt-0.5 text-orange-600" />
                      <div>
                        <strong className="text-foreground">Wholesale Units</strong> - Defines wholesale packaging types with default pricing and available flavors
                      </div>
                    </div>
                  </div>
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          
          {/* NEW SCHEMA - Flavors Management */}
          {user?.isAdmin && (
            <TabsContent value="flavors" className="space-y-4">
              <Card className="border-primary/30">
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Palette className="w-5 h-5 text-primary" />
                      Flavor Library
                    </CardTitle>
                    <CardDescription>Central repository of kombucha flavors used across retail and wholesale products</CardDescription>
                  </div>
                  <Dialog open={editingFlavor === 'new'} onOpenChange={(open) => !open && setEditingFlavor(null)}>
                    <DialogTrigger asChild>
                      <Button onClick={() => setEditingFlavor('new')} data-testid="button-create-flavor">
                        Create Flavor
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Create New Flavor</DialogTitle>
                        <DialogDescription>Add a new kombucha flavor</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div>
                          <Label htmlFor="flavor-name">Flavor Name</Label>
                          <Input
                            id="flavor-name"
                            value={flavorForm.name}
                            onChange={(e) => setFlavorForm({ ...flavorForm, name: e.target.value })}
                            data-testid="input-flavor-name"
                          />
                        </div>
                        <div>
                          <Label htmlFor="flavor-description">Description</Label>
                          <Textarea
                            id="flavor-description"
                            value={flavorForm.description}
                            onChange={(e) => setFlavorForm({ ...flavorForm, description: e.target.value })}
                            rows={3}
                            data-testid="input-flavor-description"
                          />
                        </div>
                        <div>
                          <Label htmlFor="flavor-profile">Flavor Profile</Label>
                          <Input
                            id="flavor-profile"
                            value={flavorForm.flavorProfile}
                            onChange={(e) => setFlavorForm({ ...flavorForm, flavorProfile: e.target.value })}
                            placeholder="e.g., Bright, citrusy, refreshing"
                            data-testid="input-flavor-profile"
                          />
                        </div>
                        <div>
                          <Label htmlFor="flavor-ingredients">Ingredients (comma-separated)</Label>
                          <Input
                            id="flavor-ingredients"
                            value={flavorForm.ingredients.join(', ')}
                            onChange={(e) => setFlavorForm({ ...flavorForm, ingredients: e.target.value.split(',').map(s => s.trim()) })}
                            placeholder="e.g., Grapefruit, Ginger, Lemon"
                            data-testid="input-flavor-ingredients"
                          />
                        </div>
                        <div>
                          <Label htmlFor="flavor-image">Image URL</Label>
                          <Input
                            id="flavor-image"
                            value={flavorForm.imageUrl}
                            onChange={(e) => setFlavorForm({ ...flavorForm, imageUrl: e.target.value })}
                            data-testid="input-flavor-image"
                          />
                        </div>
                        <div>
                          <Label htmlFor="flavor-order">Display Order</Label>
                          <Input
                            id="flavor-order"
                            type="number"
                            value={flavorForm.displayOrder}
                            onChange={(e) => setFlavorForm({ ...flavorForm, displayOrder: parseInt(e.target.value) || 0 })}
                            data-testid="input-flavor-order"
                          />
                        </div>
                        <Button
                          onClick={() => createFlavorMutation.mutate(flavorForm)}
                          disabled={createFlavorMutation.isPending}
                          className="w-full"
                          data-testid="button-save-flavor"
                        >
                          {createFlavorMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            'Create Flavor'
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
              </Card>
              
              {flavorsLoading ? (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-muted-foreground">Loading flavors...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {flavors.map((flavor) => (
                    <Card key={flavor.id} data-testid={`card-flavor-${flavor.id}`}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <CardTitle>{flavor.name}</CardTitle>
                            <CardDescription>{flavor.flavorProfile}</CardDescription>
                          </div>
                          <Badge variant={flavor.isActive ? "default" : "secondary"}>
                            {flavor.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-2">{flavor.description}</p>
                        <p className="text-xs text-muted-foreground">
                          <strong>Ingredients:</strong> {flavor.ingredients.join(', ')}
                        </p>
                      </CardContent>
                      <CardFooter className="flex gap-2 flex-wrap">
                        <Dialog open={editingFlavor === flavor.id} onOpenChange={(open) => !open && setEditingFlavor(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setEditingFlavor(flavor.id);
                                setFlavorForm({
                                  name: flavor.name,
                                  description: flavor.description,
                                  flavorProfile: flavor.flavorProfile,
                                  ingredients: flavor.ingredients,
                                  imageUrl: flavor.imageUrl,
                                  isActive: flavor.isActive,
                                  displayOrder: flavor.displayOrder
                                });
                              }}
                              data-testid={`button-edit-flavor-${flavor.id}`}
                            >
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Edit {flavor.name}</DialogTitle>
                              <DialogDescription>Update flavor details</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div>
                                <Label>Flavor Name</Label>
                                <Input
                                  value={flavorForm.name}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, name: e.target.value })}
                                  data-testid="input-edit-flavor-name"
                                />
                              </div>
                              <div>
                                <Label>Description</Label>
                                <Textarea
                                  value={flavorForm.description}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, description: e.target.value })}
                                  rows={3}
                                  data-testid="input-edit-flavor-description"
                                />
                              </div>
                              <div>
                                <Label>Flavor Profile</Label>
                                <Input
                                  value={flavorForm.flavorProfile}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, flavorProfile: e.target.value })}
                                  data-testid="input-edit-flavor-profile"
                                />
                              </div>
                              <div>
                                <Label>Ingredients (comma-separated)</Label>
                                <Input
                                  value={flavorForm.ingredients.join(', ')}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, ingredients: e.target.value.split(',').map(s => s.trim()) })}
                                  data-testid="input-edit-flavor-ingredients"
                                />
                              </div>
                              <div>
                                <Label>Image URL</Label>
                                <Input
                                  value={flavorForm.imageUrl}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, imageUrl: e.target.value })}
                                  data-testid="input-edit-flavor-image"
                                />
                              </div>
                              <div>
                                <Label>Display Order</Label>
                                <Input
                                  type="number"
                                  value={flavorForm.displayOrder}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, displayOrder: parseInt(e.target.value) || 0 })}
                                  data-testid="input-edit-flavor-order"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={flavorForm.isActive}
                                  onChange={(e) => setFlavorForm({ ...flavorForm, isActive: e.target.checked })}
                                  data-testid="input-edit-flavor-active"
                                />
                                <Label>Active</Label>
                              </div>
                              <Button
                                onClick={() => updateFlavorMutation.mutate({ id: flavor.id, data: flavorForm })}
                                disabled={updateFlavorMutation.isPending}
                                className="w-full"
                                data-testid="button-update-flavor"
                              >
                                {updateFlavorMutation.isPending ? (
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
                            if (confirm(`Delete flavor "${flavor.name}"?`)) {
                              deleteFlavorMutation.mutate(flavor.id);
                            }
                          }}
                          disabled={deleteFlavorMutation.isPending}
                          data-testid={`button-delete-flavor-${flavor.id}`}
                        >
                          Delete
                        </Button>
                      </CardFooter>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          )}
          
          {/* NEW SCHEMA - Retail Products Management */}
          {user?.isAdmin && (
            <TabsContent value="retail-products" className="space-y-4">
              <Card className="border-accent/30">
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
                    const flavor = flavors.find(f => f.id === product.flavorId);
                    return (
                      <Card key={product.id} data-testid={`card-retail-product-${product.id}`}>
                        <CardHeader>
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <CardTitle>{flavor?.name || 'Unknown Flavor'}</CardTitle>
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
                              <span className="font-semibold">${Number(product.price).toFixed(2)}</span>
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
            </TabsContent>
          )}
          
          {/* NEW SCHEMA - Wholesale Unit Types Management */}
          {user?.isAdmin && (
            <TabsContent value="wholesale-units" className="space-y-4">
              <Card className="border-orange-600/30">
                <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Box className="w-5 h-5 text-orange-600" />
                      Wholesale Packaging Types
                    </CardTitle>
                    <CardDescription>Define wholesale unit types with default pricing and which flavors are available for each unit</CardDescription>
                  </div>
                  <Dialog open={editingWholesaleUnitType === 'new'} onOpenChange={(open) => !open && setEditingWholesaleUnitType(null)}>
                    <DialogTrigger asChild>
                      <Button onClick={() => setEditingWholesaleUnitType('new')} data-testid="button-create-wholesale-unit">
                        Create Unit Type
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Create New Wholesale Unit Type</DialogTitle>
                        <DialogDescription>Add a wholesale unit type with default pricing</DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div>
                          <Label htmlFor="wholesale-name">Name</Label>
                          <Input
                            id="wholesale-name"
                            value={wholesaleUnitTypeForm.name}
                            onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, name: e.target.value })}
                            placeholder="e.g., Half Barrel Keg"
                            data-testid="input-wholesale-name"
                          />
                        </div>
                        <div>
                          <Label htmlFor="wholesale-unit-type">Unit Type ID</Label>
                          <Input
                            id="wholesale-unit-type"
                            value={wholesaleUnitTypeForm.unitType}
                            onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, unitType: e.target.value })}
                            placeholder="e.g., half_barrel_keg"
                            data-testid="input-wholesale-unit-type"
                          />
                        </div>
                        <div>
                          <Label htmlFor="wholesale-description">Description</Label>
                          <Textarea
                            id="wholesale-description"
                            value={wholesaleUnitTypeForm.description}
                            onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, description: e.target.value })}
                            rows={3}
                            data-testid="input-wholesale-description"
                          />
                        </div>
                        <div>
                          <Label htmlFor="wholesale-price">Default Price</Label>
                          <Input
                            id="wholesale-price"
                            type="number"
                            step="0.01"
                            value={wholesaleUnitTypeForm.defaultPrice}
                            onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, defaultPrice: parseFloat(e.target.value) || 0 })}
                            data-testid="input-wholesale-price"
                          />
                        </div>
                        <div>
                          <Label htmlFor="wholesale-display-order">Display Order</Label>
                          <Input
                            id="wholesale-display-order"
                            type="number"
                            value={wholesaleUnitTypeForm.displayOrder}
                            onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, displayOrder: parseInt(e.target.value) || 0 })}
                            data-testid="input-wholesale-display-order"
                          />
                        </div>
                        <Button
                          onClick={() => createWholesaleUnitTypeMutation.mutate(wholesaleUnitTypeForm)}
                          disabled={createWholesaleUnitTypeMutation.isPending}
                          className="w-full"
                          data-testid="button-save-wholesale-unit"
                        >
                          {createWholesaleUnitTypeMutation.isPending ? (
                            <>
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                              Creating...
                            </>
                          ) : (
                            'Create Unit Type'
                          )}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardHeader>
              </Card>
              
              {wholesaleUnitTypesLoading ? (
                <div className="flex items-center justify-center py-12 gap-2">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-muted-foreground">Loading wholesale unit types...</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {wholesaleUnitTypes.map((unitType) => (
                    <Card key={unitType.id} data-testid={`card-wholesale-unit-${unitType.id}`}>
                      <CardHeader>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <CardTitle>{unitType.name}</CardTitle>
                            <CardDescription>{unitType.unitType}</CardDescription>
                          </div>
                          <Badge variant={unitType.isActive ? "default" : "secondary"}>
                            {unitType.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-2">{unitType.description}</p>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Default Price:</span>
                          <span className="font-semibold">${Number(unitType.defaultPrice).toFixed(2)}</span>
                        </div>
                      </CardContent>
                      <CardFooter className="flex gap-2 flex-wrap">
                        <Dialog open={editingWholesaleUnitType === unitType.id} onOpenChange={(open) => !open && setEditingWholesaleUnitType(null)}>
                          <DialogTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => {
                                setEditingWholesaleUnitType(unitType.id);
                                setWholesaleUnitTypeForm({
                                  name: unitType.name,
                                  unitType: unitType.unitType,
                                  description: unitType.description,
                                  defaultPrice: Number(unitType.defaultPrice),
                                  availableFlavors: [],
                                  isActive: unitType.isActive,
                                  displayOrder: unitType.displayOrder
                                });
                              }}
                              data-testid={`button-edit-wholesale-unit-${unitType.id}`}
                            >
                              Edit
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                            <DialogHeader>
                              <DialogTitle>Edit {unitType.name}</DialogTitle>
                              <DialogDescription>Update wholesale unit type details</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-4">
                              <div>
                                <Label>Name</Label>
                                <Input
                                  value={wholesaleUnitTypeForm.name}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, name: e.target.value })}
                                  data-testid="input-edit-wholesale-name"
                                />
                              </div>
                              <div>
                                <Label>Unit Type ID</Label>
                                <Input
                                  value={wholesaleUnitTypeForm.unitType}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, unitType: e.target.value })}
                                  data-testid="input-edit-wholesale-unit-type"
                                />
                              </div>
                              <div>
                                <Label>Description</Label>
                                <Textarea
                                  value={wholesaleUnitTypeForm.description}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, description: e.target.value })}
                                  rows={3}
                                  data-testid="input-edit-wholesale-description"
                                />
                              </div>
                              <div>
                                <Label>Default Price</Label>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={wholesaleUnitTypeForm.defaultPrice}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, defaultPrice: parseFloat(e.target.value) || 0 })}
                                  data-testid="input-edit-wholesale-price"
                                />
                              </div>
                              <div>
                                <Label>Display Order</Label>
                                <Input
                                  type="number"
                                  value={wholesaleUnitTypeForm.displayOrder}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, displayOrder: parseInt(e.target.value) || 0 })}
                                  data-testid="input-edit-wholesale-display-order"
                                />
                              </div>
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={wholesaleUnitTypeForm.isActive}
                                  onChange={(e) => setWholesaleUnitTypeForm({ ...wholesaleUnitTypeForm, isActive: e.target.checked })}
                                  data-testid="input-edit-wholesale-active"
                                />
                                <Label>Active</Label>
                              </div>
                              <Button
                                onClick={() => updateWholesaleUnitTypeMutation.mutate({ id: unitType.id, data: wholesaleUnitTypeForm })}
                                disabled={updateWholesaleUnitTypeMutation.isPending}
                                className="w-full"
                                data-testid="button-update-wholesale-unit"
                              >
                                {updateWholesaleUnitTypeMutation.isPending ? (
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
                            if (confirm(`Delete wholesale unit type "${unitType.name}"?`)) {
                              deleteWholesaleUnitTypeMutation.mutate(unitType.id);
                            }
                          }}
                          disabled={deleteWholesaleUnitTypeMutation.isPending}
                          data-testid={`button-delete-wholesale-unit-${unitType.id}`}
                        >
                          Delete
                        </Button>
                      </CardFooter>
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
