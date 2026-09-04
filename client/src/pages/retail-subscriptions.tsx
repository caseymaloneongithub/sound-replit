import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Loader2, Plus, Edit, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { flavorOptionLabel } from "@/lib/flavor-display";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import type { RetailSubscription, RetailProduct, Flavor } from "@shared/schema";

type RetailCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  subscriptionCount: number;
  activeSubscriptionCount: number;
};

type SubscriptionWithItems = RetailSubscription & {
  items: Array<{
    id: string;
    subscriptionId: string;
    retailProductId: string;
    selectedFlavorId: string | null;
    quantity: number;
    notes: string | null;
    retailProduct: RetailProduct;
    flavor: Flavor | null;
  }>;
};

function getStatusColor(status: string): string {
  switch (status) {
    case 'active': return 'bg-green-500';
    case 'paused': return 'bg-yellow-500';
    case 'cancelled': return 'bg-red-500';
    default: return 'bg-gray-500';
  }
}

function getStatusLabel(status: string): string {
  switch (status) {
    case 'active': return 'Active';
    case 'paused': return 'Paused';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
}

function getFrequencyLabel(frequency: string): string {
  switch (frequency) {
    case 'weekly': return 'Weekly';
    case 'bi-weekly': return 'Bi-weekly';
    case 'every-4-weeks': return 'Every 4 weeks';
    case 'every-6-weeks': return 'Every 6 weeks';
    case 'every-8-weeks': return 'Every 8 weeks';
    default: return frequency;
  }
}

const subscriptionSchema = z.object({
  userId: z.string().optional(),
  customerName: z.string().min(1, "Customer name is required"),
  customerEmail: z.string().email("Valid email is required"),
  customerPhone: z.string().min(1, "Phone is required"),
  subscriptionFrequency: z.enum(['weekly', 'bi-weekly', 'every-4-weeks', 'every-6-weeks', 'every-8-weeks']),
  status: z.enum(['active', 'paused', 'cancelled']),
  nextDeliveryDate: z.string().optional(),
});

type SubscriptionFormData = z.infer<typeof subscriptionSchema>;

export default function RetailSubscriptions() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] = useState<SubscriptionWithItems | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [selectedSubscriptionForItem, setSelectedSubscriptionForItem] = useState<string | null>(null);
  // Add-item dialog: product first, then a flavor picker. Picking Mixed on an
  // allowSplit product offers "a little of everything" vs "pick 2 flavors".
  const [addProductId, setAddProductId] = useState<string>('');
  const [addFlavorId, setAddFlavorId] = useState<string>('');
  const [addPickTwo, setAddPickTwo] = useState(false);
  const [addPickA, setAddPickA] = useState<string>('');
  const [addPickB, setAddPickB] = useState<string>('');
  const [newSubscriptionItems, setNewSubscriptionItems] = useState<Array<{ retailProductId: string; flavorId: string; quantity: number }>>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');

  const form = useForm<SubscriptionFormData>({
    resolver: zodResolver(subscriptionSchema),
    defaultValues: {
      userId: '',
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      subscriptionFrequency: 'bi-weekly',
      status: 'active',
      nextDeliveryDate: '',
    },
  });

  const { data: subscriptions = [], isLoading } = useQuery<SubscriptionWithItems[]>({
    queryKey: ['/api/retail/subscriptions'],
  });

  const { data: retailProducts = [] } = useQuery<RetailProduct[]>({
    queryKey: ['/api/retail-products'],
  });

  const { data: flavors = [] } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });

  const { data: retailCustomers = [] } = useQuery<RetailCustomer[]>({
    queryKey: ['/api/retail/customers'],
  });

  const createSubscriptionMutation = useMutation({
    mutationFn: async (data: SubscriptionFormData & { items: Array<{ retailProductId: string; selectedFlavorId: string | null; quantity: number }> }) => {
      return await apiRequest('POST', '/api/retail/subscriptions', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/retail/customers'] });
      toast({
        title: "Subscription created",
        description: "The new subscription has been created successfully",
      });
      setDialogOpen(false);
      setIsCreating(false);
      setNewSubscriptionItems([]);
      setSelectedCustomerId('');
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create subscription",
        variant: "destructive",
      });
    },
  });

  const updateSubscriptionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<SubscriptionFormData> }) => {
      return await apiRequest('PATCH', `/api/retail/subscriptions/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      toast({
        title: "Subscription updated",
        description: "The subscription has been updated successfully",
      });
      setDialogOpen(false);
      setEditingSubscription(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update subscription",
        variant: "destructive",
      });
    },
  });

  const deleteSubscriptionMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/retail/subscriptions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      toast({
        title: "Subscription deleted",
        description: "The subscription has been deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete subscription",
        variant: "destructive",
      });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: async ({ subscriptionId, itemId }: { subscriptionId: string; itemId: string }) => {
      return await apiRequest('DELETE', `/api/retail/subscriptions/${subscriptionId}/items/${itemId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      toast({
        title: "Item removed",
        description: "The item has been removed from the subscription",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove item",
        variant: "destructive",
      });
    },
  });

  const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const itemNoteMutation = useMutation({
    mutationFn: async ({ subscriptionId, itemId, notes }: { subscriptionId: string; itemId: string; notes: string }) => {
      return await apiRequest('PATCH', `/api/retail/subscriptions/${subscriptionId}/items/${itemId}`, { notes });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      setEditingNoteItemId(null);
      toast({ title: "Note saved", description: "It will appear on every order this subscription generates." });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to save note", variant: "destructive" });
    },
  });

  const addItemMutation = useMutation({
    mutationFn: async ({ subscriptionId, retailProductId, selectedFlavorId, splitFlavorId, quantity }: { subscriptionId: string; retailProductId: string; selectedFlavorId?: string; splitFlavorId?: string; quantity: number }) => {
      return await apiRequest('POST', `/api/retail/subscriptions/${subscriptionId}/items`, {
        retailProductId,
        selectedFlavorId,
        splitFlavorId,
        quantity,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/retail/subscriptions'] });
      toast({
        title: "Item added",
        description: "The item has been added to the subscription",
      });
      setAddItemDialogOpen(false);
      setSelectedSubscriptionForItem(null);
      setAddProductId('');
      setAddFlavorId('');
      setAddPickTwo(false);
      setAddPickA('');
      setAddPickB('');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add item",
        variant: "destructive",
      });
    },
  });

  const handleEditSubscription = (subscription: SubscriptionWithItems) => {
    setEditingSubscription(subscription);
    setIsCreating(false);
    form.reset({
      customerName: subscription.customerName,
      customerEmail: subscription.customerEmail,
      customerPhone: subscription.customerPhone,
      subscriptionFrequency: subscription.subscriptionFrequency as SubscriptionFormData['subscriptionFrequency'],
      status: subscription.status as SubscriptionFormData['status'],
      nextDeliveryDate: subscription.nextDeliveryDate ? format(new Date(subscription.nextDeliveryDate), 'yyyy-MM-dd') : '',
    });
    setDialogOpen(true);
  };

  const handleCreateSubscription = () => {
    setEditingSubscription(null);
    setIsCreating(true);
    setNewSubscriptionItems([]);
    setSelectedCustomerId('');
    form.reset({
      userId: '',
      customerName: '',
      customerEmail: '',
      customerPhone: '',
      subscriptionFrequency: 'bi-weekly',
      status: 'active',
      nextDeliveryDate: format(new Date(), 'yyyy-MM-dd'),
    });
    setDialogOpen(true);
  };

  const handleCustomerSelect = (customerId: string) => {
    setSelectedCustomerId(customerId);
    const customer = retailCustomers.find(c => c.id === customerId);
    if (customer) {
      form.setValue('userId', customer.id);
      form.setValue('customerName', `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.email);
      form.setValue('customerEmail', customer.email || '');
      form.setValue('customerPhone', customer.phoneNumber || '');
    }
  };

  const handleAddNewItem = () => {
    setNewSubscriptionItems([...newSubscriptionItems, { retailProductId: '', flavorId: '', quantity: 1 }]);
  };

  const handleRemoveNewItem = (index: number) => {
    setNewSubscriptionItems(newSubscriptionItems.filter((_, i) => i !== index));
  };

  const handleUpdateNewItem = (index: number, field: 'retailProductId' | 'flavorId' | 'quantity', value: string | number) => {
    const updated = [...newSubscriptionItems];
    if (field === 'quantity') {
      updated[index][field] = value as number;
    } else {
      updated[index][field] = value as string;
      if (field === 'retailProductId') {
        const selectedProduct = retailProducts.find(p => p.id === value);
        if (selectedProduct?.productType === 'single-flavor' && selectedProduct.flavorId) {
          updated[index].flavorId = selectedProduct.flavorId;
        } else {
          updated[index].flavorId = '';
        }
      }
    }
    setNewSubscriptionItems(updated);
  };

  const onSubmit = (data: SubscriptionFormData) => {
    if (isCreating) {
      if (!selectedCustomerId) {
        toast({
          title: "No customer selected",
          description: "Please select a customer to create a subscription for",
          variant: "destructive",
        });
        return;
      }
      if (newSubscriptionItems.length === 0 || newSubscriptionItems.some(item => !item.retailProductId || !item.flavorId)) {
        toast({
          title: "Missing items",
          description: "Please add at least one item with a product and flavor selected",
          variant: "destructive",
        });
        return;
      }
      // The server field is selectedFlavorId — sending `flavorId` was silently
      // dropped, which per-flavor products masked (their product carried the
      // flavor) but the consolidated multi-flavor product does not.
      createSubscriptionMutation.mutate({
        ...data,
        items: newSubscriptionItems.map(i => ({
          retailProductId: i.retailProductId,
          selectedFlavorId: i.flavorId || null,
          quantity: i.quantity,
        })),
      });
    } else if (editingSubscription) {
      updateSubscriptionMutation.mutate({ id: editingSubscription.id, data });
    }
  };

  // Filter subscriptions
  const filteredSubscriptions = subscriptions.filter(sub => {
    const matchesStatus = activeTab === 'all' || sub.status === activeTab;
    const matchesSearch = !searchQuery || 
      sub.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.customerEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      sub.customerPhone.includes(searchQuery);
    return matchesStatus && matchesSearch;
  });

  // Count by status
  const counts = {
    all: subscriptions.length,
    active: subscriptions.filter(s => s.status === 'active').length,
    paused: subscriptions.filter(s => s.status === 'paused').length,
    cancelled: subscriptions.filter(s => s.status === 'cancelled').length,
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              Retail Subscriptions
            </h1>
            <p className="text-muted-foreground">
              Manage customer subscriptions
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Input
                placeholder="Search by name, email, phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64"
                data-testid="input-search-subscriptions"
              />
            </div>
            <Button onClick={handleCreateSubscription} data-testid="button-add-subscription">
              <Plus className="w-4 h-4 mr-2" />
              Add Subscription
            </Button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{counts.all}</div>
              <p className="text-sm text-muted-foreground">Total Subscriptions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-green-600">{counts.active}</div>
              <p className="text-sm text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-yellow-600">{counts.paused}</div>
              <p className="text-sm text-muted-foreground">Paused</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold text-red-600">{counts.cancelled}</div>
              <p className="text-sm text-muted-foreground">Cancelled</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="all" data-testid="tab-all">All ({counts.all})</TabsTrigger>
            <TabsTrigger value="active" data-testid="tab-active">Active ({counts.active})</TabsTrigger>
            <TabsTrigger value="paused" data-testid="tab-paused">Paused ({counts.paused})</TabsTrigger>
            <TabsTrigger value="cancelled" data-testid="tab-cancelled">Cancelled ({counts.cancelled})</TabsTrigger>
          </TabsList>

          {['all', 'active', 'paused', 'cancelled'].map((tab) => (
            <TabsContent key={tab} value={tab}>
              {isLoading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSubscriptions.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <h3 className="text-lg font-semibold mb-2">No subscriptions found</h3>
                    <p className="text-muted-foreground">
                      {searchQuery ? "Try a different search term" : "No subscriptions in this category"}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-4">
                  {filteredSubscriptions.map((subscription) => (
                    <Card key={subscription.id} data-testid={`subscription-card-${subscription.id}`}>
                      <CardHeader className="flex flex-row items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <CardTitle className="text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
                              {subscription.customerName}
                            </CardTitle>
                            <Badge className={getStatusColor(subscription.status)}>
                              {getStatusLabel(subscription.status)}
                            </Badge>
                            <Badge variant="outline">
                              {getFrequencyLabel(subscription.subscriptionFrequency)}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                              {subscription.customerEmail}
                            </span>
                            <span className="flex items-center gap-1">
                              {subscription.customerPhone}
                            </span>
                            {subscription.nextDeliveryDate && (
                              <span className="flex items-center gap-1">
                                Next: {format(new Date(subscription.nextDeliveryDate), 'MMM d, yyyy')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEditSubscription(subscription)}
                            data-testid={`button-edit-${subscription.id}`}
                          >
                            <Edit className="w-4 h-4 mr-1" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                data-testid={`button-delete-${subscription.id}`}
                              >
                                <Trash2 className="w-4 h-4 mr-1" />
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Subscription</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete this subscription for {subscription.customerName}? 
                                  This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteSubscriptionMutation.mutate(subscription.id)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-medium">Subscription Items</h4>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setSelectedSubscriptionForItem(subscription.id);
                                setAddItemDialogOpen(true);
                              }}
                              data-testid={`button-add-item-${subscription.id}`}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              Add Item
                            </Button>
                          </div>
                          {subscription.items.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No items in this subscription</p>
                          ) : (
                            <div className="divide-y">
                              {subscription.items.map((item) => (
                                <div key={item.id} className="py-2 flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div>
                                      <p className="font-medium">
                                        {item.flavor?.name || 'Unknown'} - {item.retailProduct?.unitDescription || 'Unknown'}
                                      </p>
                                      <p className="text-sm text-muted-foreground">
                                        Qty: {item.quantity} case{item.quantity > 1 ? 's' : ''}
                                      </p>
                                      {editingNoteItemId === item.id ? (
                                        <div className="mt-1 flex items-center gap-2">
                                          <Input
                                            value={noteDraft}
                                            onChange={(e) => setNoteDraft(e.target.value)}
                                            placeholder="e.g. 6 HUM, 6 Mist"
                                            className="h-8 w-64 text-sm"
                                            autoFocus
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') itemNoteMutation.mutate({ subscriptionId: subscription.id, itemId: item.id, notes: noteDraft });
                                              if (e.key === 'Escape') setEditingNoteItemId(null);
                                            }}
                                            data-testid={`input-item-note-${item.id}`}
                                          />
                                          <Button size="sm" className="h-8" disabled={itemNoteMutation.isPending}
                                            onClick={() => itemNoteMutation.mutate({ subscriptionId: subscription.id, itemId: item.id, notes: noteDraft })}>
                                            Save
                                          </Button>
                                          <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingNoteItemId(null)}>Cancel</Button>
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          className="mt-0.5 text-xs text-muted-foreground hover:text-foreground underline decoration-dotted text-left"
                                          onClick={() => { setEditingNoteItemId(item.id); setNoteDraft(item.notes || ''); }}
                                          data-testid={`button-item-note-${item.id}`}
                                        >
                                          {item.notes ? item.notes : '+ Packing note'}
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                  {subscription.items.length > 1 && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => deleteItemMutation.mutate({ 
                                        subscriptionId: subscription.id, 
                                        itemId: item.id 
                                      })}
                                      disabled={deleteItemMutation.isPending}
                                      data-testid={`button-remove-item-${item.id}`}
                                    >
                                      <Trash2 className="w-4 h-4 text-muted-foreground" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        
                        {/* Billing Info */}
                        <div className="mt-4 pt-4 border-t">
                          <div className="grid grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="text-muted-foreground">Billing Type:</span>
                              <span className="ml-2 font-medium">{subscription.billingType === 'stripe_managed' ? 'Stripe Managed' : 'Local Managed'}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Billing Status:</span>
                              <Badge variant="outline" className="ml-2">
                                {subscription.billingStatus}
                              </Badge>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Started:</span>
                              <span className="ml-2">{format(new Date(subscription.startDate), 'MMM d, yyyy')}</span>
                            </div>
                            {subscription.stripeSubscriptionId && (
                              <div>
                                <span className="text-muted-foreground">Stripe ID:</span>
                                <span className="ml-2 text-xs font-mono">{subscription.stripeSubscriptionId}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>

        {/* Create/Edit Subscription Dialog */}
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            setEditingSubscription(null);
            setIsCreating(false);
            setNewSubscriptionItems([]);
            setSelectedCustomerId('');
            form.reset();
          }
        }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{isCreating ? 'Create Subscription' : 'Edit Subscription'}</DialogTitle>
              <DialogDescription>
                {isCreating 
                  ? 'Create a new subscription for a customer' 
                  : `Update the subscription details for ${editingSubscription?.customerName}`}
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {/* Customer Selection for new subscriptions */}
                {isCreating && (
                  <div className="space-y-2">
                    <Label>Select Customer</Label>
                    <Select
                      value={selectedCustomerId}
                      onValueChange={handleCustomerSelect}
                    >
                      <SelectTrigger data-testid="select-customer">
                        <SelectValue placeholder="Select an existing customer..." />
                      </SelectTrigger>
                      <SelectContent>
                        {retailCustomers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.firstName && customer.lastName 
                              ? `${customer.firstName} ${customer.lastName}` 
                              : customer.email} 
                            {customer.activeSubscriptionCount > 0 && (
                              <span className="text-muted-foreground ml-2">
                                ({customer.activeSubscriptionCount} active)
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {retailCustomers.length === 0 && (
                      <p className="text-sm text-muted-foreground">No retail customers found</p>
                    )}
                  </div>
                )}

                {/* Customer details - read-only when customer selected, editable for edit mode */}
                <FormField
                  control={form.control}
                  name="customerName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer Name</FormLabel>
                      <FormControl>
                        <Input {...field} readOnly={isCreating && !!selectedCustomerId} className={isCreating && selectedCustomerId ? "bg-muted" : ""} data-testid="input-customer-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customerEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" {...field} readOnly={isCreating && !!selectedCustomerId} className={isCreating && selectedCustomerId ? "bg-muted" : ""} data-testid="input-customer-email" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="customerPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone</FormLabel>
                      <FormControl>
                        <Input {...field} readOnly={isCreating && !!selectedCustomerId} className={isCreating && selectedCustomerId ? "bg-muted" : ""} data-testid="input-customer-phone" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="subscriptionFrequency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Frequency</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-frequency">
                            <SelectValue placeholder="Select frequency" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="bi-weekly">Bi-weekly (every 2 weeks)</SelectItem>
                          <SelectItem value="every-4-weeks">Every 4 weeks</SelectItem>
                          <SelectItem value="every-6-weeks">Every 6 weeks</SelectItem>
                          <SelectItem value="every-8-weeks">Every 8 weeks</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Status</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-status">
                            <SelectValue placeholder="Select status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="paused">Paused</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="nextDeliveryDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Next Pickup Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} data-testid="input-next-delivery-date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Items section for new subscriptions */}
                {isCreating && (
                  <div className="space-y-4 pt-4 border-t">
                    <div className="flex items-center justify-between">
                      <Label className="text-base font-medium">Subscription Items</Label>
                      <Button type="button" variant="outline" size="sm" onClick={handleAddNewItem} data-testid="button-add-new-item">
                        <Plus className="w-4 h-4 mr-1" />
                        Add Item
                      </Button>
                    </div>
                    {newSubscriptionItems.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Add at least one item to create the subscription</p>
                    ) : (
                      <div className="space-y-3">
                        {newSubscriptionItems.map((item, index) => {
                          const selectedProduct = retailProducts.find(p => p.id === item.retailProductId);
                          // Multi-flavor products offer THEIR flavors (active only);
                          // single-flavor products are locked to their own.
                          const productFlavorList: Flavor[] = ((selectedProduct as any)?.flavors ?? []).filter((f: Flavor) => f.isActive);
                          const availableFlavors = selectedProduct?.productType === 'single-flavor' && selectedProduct.flavorId
                            ? flavors.filter(f => f.id === selectedProduct.flavorId)
                            : (productFlavorList.length > 0 ? productFlavorList : flavors.filter(f => f.isActive));
                          return (
                            <div key={index} className="flex items-start gap-2 p-3 border rounded-md">
                              <div className="flex-1 space-y-2">
                                <div>
                                  <Label className="text-xs">Product</Label>
                                  <Select
                                    value={item.retailProductId}
                                    onValueChange={(value) => handleUpdateNewItem(index, 'retailProductId', value)}
                                  >
                                    <SelectTrigger data-testid={`select-new-product-${index}`}>
                                      <SelectValue placeholder="Select product" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {retailProducts
                                        .filter(p => p.isActive
                                          && (p.productType !== 'single-flavor' || !p.flavorId || flavors.some(f => f.id === p.flavorId && f.isActive)))
                                        .map((product) => {
                                        const productFlavor = product.productType === 'single-flavor' && product.flavorId
                                          ? flavors.find(f => f.id === product.flavorId)
                                          : null;
                                        return (
                                          <SelectItem key={product.id} value={product.id}>
                                            {product.productType === 'multi-flavor' && (product as any).productName
                                              ? `${(product as any).productName} — ${product.unitDescription}`
                                              : product.unitDescription}
                                            {productFlavor && ` - ${productFlavor.name}`}
                                          </SelectItem>
                                        );
                                      })}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Flavor</Label>
                                  <Select
                                    value={item.flavorId}
                                    onValueChange={(value) => handleUpdateNewItem(index, 'flavorId', value)}
                                    disabled={!item.retailProductId}
                                  >
                                    <SelectTrigger data-testid={`select-new-flavor-${index}`}>
                                      <SelectValue placeholder="Select flavor" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {availableFlavors.map((flavor) => (
                                        <SelectItem key={flavor.id} value={flavor.id}>
                                          {flavor.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">Quantity</Label>
                                  <Select
                                    value={String(item.quantity)}
                                    onValueChange={(value) => handleUpdateNewItem(index, 'quantity', parseInt(value))}
                                  >
                                    <SelectTrigger data-testid={`select-new-quantity-${index}`}>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {[1, 2, 3, 4, 5].map((qty) => (
                                        <SelectItem key={qty} value={String(qty)}>
                                          {qty} case{qty > 1 ? 's' : ''}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleRemoveNewItem(index)}
                                data-testid={`button-remove-new-item-${index}`}
                              >
                                <Trash2 className="w-4 h-4 text-muted-foreground" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setDialogOpen(false);
                      setEditingSubscription(null);
                      setIsCreating(false);
                      setNewSubscriptionItems([]);
                      setSelectedCustomerId('');
                      form.reset();
                    }}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={isCreating ? createSubscriptionMutation.isPending : updateSubscriptionMutation.isPending}
                    data-testid="button-save-subscription"
                  >
                    {(isCreating ? createSubscriptionMutation.isPending : updateSubscriptionMutation.isPending) ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        {isCreating ? 'Creating...' : 'Saving...'}
                      </>
                    ) : (
                      isCreating ? 'Create Subscription' : 'Save Changes'
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        {/* Add Item Dialog: product first, then flavor picker(s) — two for a split
            case, mirroring the shop so staff can rebuild any line a customer could buy. */}
        <Dialog open={addItemDialogOpen} onOpenChange={(open) => {
          setAddItemDialogOpen(open);
          if (!open) {
            setSelectedSubscriptionForItem(null);
            setAddProductId('');
            setAddFlavorId('');
            setAddPickTwo(false);
            setAddPickA('');
            setAddPickB('');
          }
        }}>
          <DialogContent className="sm:max-w-[400px]">
            <DialogHeader>
              <DialogTitle>Add Item to Subscription</DialogTitle>
              <DialogDescription>
                Select a product to add to this subscription
              </DialogDescription>
            </DialogHeader>
            {(() => {
              const addProduct = retailProducts.find(p => p.id === addProductId);
              const isMulti = addProduct?.productType === 'multi-flavor';
              const isSplit = isMulti && !!(addProduct as any)?.allowSplit;
              const productFlavors: Flavor[] = ((addProduct as any)?.flavors ?? []).filter((f: Flavor) => f.isActive);
              const pickList = productFlavors.length > 0 ? productFlavors : flavors.filter(f => f.isActive);
              // Picking Mixed on an allowSplit product offers a choice: the full
              // assortment, or pick 2 flavors (6 of each) — a split under the hood.
              const firstName = pickList.find(f => f.id === addFlavorId)?.name;
              const mixedChoice = isSplit && firstName === 'Mixed';
              const pickTwoActive = mixedChoice && addPickTwo;
              const pickTwoReady = !!addPickA && !!addPickB && addPickA !== addPickB;
              const ready = !!addProductId && (!isMulti || !!addFlavorId) && (!pickTwoActive || pickTwoReady);
              return (
                <div className="space-y-4">
                  <div>
                    <Label>Product</Label>
                    <Select
                      value={addProductId}
                      onValueChange={(value) => { setAddProductId(value); setAddFlavorId(''); setAddPickTwo(false); setAddPickA(''); setAddPickB(''); }}
                    >
                      <SelectTrigger data-testid="select-add-product">
                        <SelectValue placeholder="Select a product" />
                      </SelectTrigger>
                      <SelectContent>
                        {retailProducts
                          .filter(p => p.isActive
                            // A single-flavor product whose flavor was retired can't be
                            // added — it rendered as a blank, unlabeled row (Evergreen).
                            && (p.productType !== 'single-flavor' || !p.flavorId || flavors.some(f => f.id === p.flavorId && f.isActive)))
                          .map((product) => {
                          const productFlavor = product.productType === 'single-flavor' && product.flavorId
                            ? flavors.find(f => f.id === product.flavorId)
                            : null;
                          return (
                            <SelectItem key={product.id} value={product.id}>
                              {product.productType === 'multi-flavor' && (product as any).productName
                                ? `${(product as any).productName} — ${product.unitDescription}`
                                : product.unitDescription}
                              {productFlavor && ` - ${productFlavor.name}`}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>

                  {isMulti && (
                    <div>
                      <Label>Flavor</Label>
                      <Select value={addFlavorId} onValueChange={setAddFlavorId}>
                        <SelectTrigger data-testid="select-add-flavor">
                          <SelectValue placeholder="Choose a flavor" />
                        </SelectTrigger>
                        <SelectContent>
                          {pickList.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{flavorOptionLabel(f.name)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {mixedChoice && (
                    <div>
                      <div className="grid grid-cols-2 gap-2">
                        <Button type="button" size="sm" variant={addPickTwo ? "outline" : "secondary"} onClick={() => setAddPickTwo(false)} data-testid="button-add-mixed-all">
                          A little of everything
                        </Button>
                        <Button type="button" size="sm" variant={addPickTwo ? "secondary" : "outline"} onClick={() => setAddPickTwo(true)} data-testid="button-add-mixed-pick2">
                          Pick 2 flavors
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {addPickTwo ? "6 of each flavor picked." : "2 of each flavor."}
                      </p>
                      {addPickTwo && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <Select value={addPickA} onValueChange={setAddPickA}>
                            <SelectTrigger data-testid="select-add-pick2-a">
                              <SelectValue placeholder="First flavor" />
                            </SelectTrigger>
                            <SelectContent>
                              {pickList.filter((f) => f.name !== 'Mixed' && f.id !== addPickB).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={addPickB} onValueChange={setAddPickB}>
                            <SelectTrigger data-testid="select-add-pick2-b">
                              <SelectValue placeholder="Second flavor" />
                            </SelectTrigger>
                            <SelectContent>
                              {pickList.filter((f) => f.name !== 'Mixed' && f.id !== addPickA).map((f) => (
                                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    className="w-full"
                    disabled={!ready || addItemMutation.isPending}
                    onClick={() => {
                      if (!selectedSubscriptionForItem || !ready) return;
                      addItemMutation.mutate({
                        subscriptionId: selectedSubscriptionForItem,
                        retailProductId: addProductId,
                        selectedFlavorId: (pickTwoActive ? addPickA : addFlavorId) || undefined,
                        splitFlavorId: pickTwoActive ? addPickB : undefined,
                        quantity: 1,
                      });
                    }}
                    data-testid="button-confirm-add-item"
                  >
                    {addItemMutation.isPending ? 'Adding…' : 'Add item'}
                  </Button>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
