import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Loader2, Box, DollarSign, X } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import type { WholesaleUnitType, Flavor, WholesaleCustomer, WholesaleCustomerPricing } from "@shared/schema";

export default function AdminWholesaleUnits() {
  const { toast } = useToast();
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
  const [customerPricing, setCustomerPricing] = useState<Record<string, number>>({});

  const { data: wholesaleUnitTypes = [], isLoading: wholesaleUnitTypesLoading } = useQuery<(WholesaleUnitType & { flavors?: Flavor[] })[]>({
    queryKey: ['/api/wholesale-unit-types'],
    queryFn: async () => apiRequest('GET', '/api/wholesale-unit-types?includeFlavors=true'),
  });

  const { data: allFlavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });

  const { data: wholesaleCustomers = [] } = useQuery<WholesaleCustomer[]>({
    queryKey: ['/api/wholesale/customers'],
  });

  // Fetch customer pricing when editing a unit type
  const { data: existingCustomerPricing = [], refetch: refetchPricing } = useQuery<WholesaleCustomerPricing[]>({
    queryKey: ['/api/wholesale-customer-pricing', editingWholesaleUnitType],
    queryFn: async () => {
      if (!editingWholesaleUnitType || editingWholesaleUnitType === 'new') return [];
      // We need to fetch all pricing for all customers and filter by unit type
      const allPricing = await Promise.all(
        wholesaleCustomers.map(customer =>
          apiRequest('GET', `/api/wholesale-customer-pricing/${customer.id}`)
        )
      );
      return allPricing.flat().filter((p: WholesaleCustomerPricing) => p.unitTypeId === editingWholesaleUnitType);
    },
    enabled: !!editingWholesaleUnitType && editingWholesaleUnitType !== 'new',
  });

  // Update local state when existing pricing loads
  useEffect(() => {
    if (existingCustomerPricing.length > 0) {
      const pricingMap: Record<string, number> = {};
      existingCustomerPricing.forEach((pricing) => {
        pricingMap[pricing.customerId] = Number(pricing.customPrice);
      });
      setCustomerPricing(pricingMap);
    } else if (editingWholesaleUnitType) {
      setCustomerPricing({});
    }
  }, [existingCustomerPricing, editingWholesaleUnitType]);

  const createWholesaleUnitTypeMutation = useMutation({
    mutationFn: async (data: any) => {
      // Convert defaultPrice to string for decimal type
      const { availableFlavors, ...rest } = data;
      const payload = {
        ...rest,
        defaultPrice: rest.defaultPrice.toString(),
        flavorIds: availableFlavors
      };
      return apiRequest('POST', '/api/wholesale-unit-types', payload);
    },
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
    mutationFn: async ({ id, data, pricing }: { id: string; data: any; pricing: Record<string, number> }) => {
      // Convert defaultPrice to string for decimal type if present
      const { availableFlavors, ...rest } = data;
      const payload = {
        ...rest,
        ...(rest.defaultPrice !== undefined && { defaultPrice: rest.defaultPrice.toString() }),
        flavorIds: availableFlavors
      };
      
      // Update the unit type
      const result = await apiRequest('PATCH', `/api/wholesale-unit-types/${id}`, payload);
      
      // Update customer pricing
      const pricingUpdates = Object.entries(pricing).map(([customerId, price]) => {
        return apiRequest('POST', '/api/wholesale-customer-pricing', {
          customerId,
          unitTypeId: id,
          customPrice: price
        });
      });
      
      // Delete pricing for customers not in the pricing map
      const existingPricing = existingCustomerPricing.filter(p => !pricing[p.customerId]);
      const deletions = existingPricing.map(p =>
        apiRequest('DELETE', `/api/wholesale-customer-pricing/${p.id}`)
      );
      
      await Promise.all([...pricingUpdates, ...deletions]);
      
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wholesale-unit-types'] });
      setEditingWholesaleUnitType(null);
      setCustomerPricing({});
      toast({ title: "Wholesale unit type updated", description: "Wholesale unit type and pricing have been updated successfully" });
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

  if (wholesaleUnitTypesLoading) {
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
          <h1 className="text-4xl font-bold mb-2" data-testid="text-wholesale-units-title">Wholesale Packaging Types</h1>
          <p className="text-muted-foreground">
            Define wholesale unit types with default pricing and which flavors are available for each unit
          </p>
        </div>

        <Card className="border-orange-600/30 mb-6">
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
                  <div>
                    <Label>Available Flavors</Label>
                    <div className="border rounded-md p-4 max-h-60 overflow-y-auto space-y-2">
                      {flavorsLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                      ) : (
                        allFlavors.map((flavor) => (
                          <div key={flavor.id} className="flex items-center space-x-2">
                            <Checkbox
                              id={`flavor-${flavor.id}`}
                              checked={wholesaleUnitTypeForm.availableFlavors.includes(flavor.id)}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setWholesaleUnitTypeForm({
                                    ...wholesaleUnitTypeForm,
                                    availableFlavors: [...wholesaleUnitTypeForm.availableFlavors, flavor.id]
                                  });
                                } else {
                                  setWholesaleUnitTypeForm({
                                    ...wholesaleUnitTypeForm,
                                    availableFlavors: wholesaleUnitTypeForm.availableFlavors.filter(id => id !== flavor.id)
                                  });
                                }
                              }}
                              data-testid={`checkbox-flavor-${flavor.id}`}
                            />
                            <Label htmlFor={`flavor-${flavor.id}`} className="cursor-pointer">
                              {flavor.name}
                            </Label>
                          </div>
                        ))
                      )}
                    </div>
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
                  <div className="flex justify-between text-sm mb-3">
                    <span className="text-muted-foreground">Default Price:</span>
                    <span className="font-semibold">${Number(unitType.defaultPrice).toFixed(2)}</span>
                  </div>
                  {unitType.flavors && unitType.flavors.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-muted-foreground mb-2">Available Flavors:</p>
                      <div className="flex flex-wrap gap-1">
                        {unitType.flavors.map((flavor) => (
                          <Badge key={flavor.id} variant="secondary" className="text-xs">
                            {flavor.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
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
                            availableFlavors: unitType.flavors?.map(f => f.id) || [],
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

                        <Separator className="my-4" />

                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <DollarSign className="w-4 h-4 text-primary" />
                            <Label className="text-base font-semibold">Customer-Specific Pricing</Label>
                          </div>
                          <p className="text-sm text-muted-foreground mb-3">
                            Set custom prices for specific customers. Leave empty to use default price.
                          </p>
                          <div className="border rounded-md p-4 max-h-60 overflow-y-auto space-y-3">
                            {wholesaleCustomers.length === 0 ? (
                              <p className="text-sm text-muted-foreground text-center py-4">No wholesale customers yet</p>
                            ) : (
                              wholesaleCustomers.map((customer) => (
                                <div key={customer.id} className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <p className="text-sm font-medium">{customer.businessName}</p>
                                    <p className="text-xs text-muted-foreground">{customer.contactName}</p>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Input
                                      type="number"
                                      step="0.01"
                                      placeholder={`Default: $${Number(wholesaleUnitTypeForm.defaultPrice).toFixed(2)}`}
                                      value={customerPricing[customer.id] || ''}
                                      onChange={(e) => {
                                        const value = parseFloat(e.target.value);
                                        if (e.target.value === '' || isNaN(value)) {
                                          const newPricing = { ...customerPricing };
                                          delete newPricing[customer.id];
                                          setCustomerPricing(newPricing);
                                        } else {
                                          setCustomerPricing({
                                            ...customerPricing,
                                            [customer.id]: value
                                          });
                                        }
                                      }}
                                      className="w-32"
                                      data-testid={`input-customer-price-${customer.id}`}
                                    />
                                    {customerPricing[customer.id] && (
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => {
                                          const newPricing = { ...customerPricing };
                                          delete newPricing[customer.id];
                                          setCustomerPricing(newPricing);
                                        }}
                                        data-testid={`button-clear-customer-price-${customer.id}`}
                                      >
                                        <X className="h-4 w-4" />
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <Separator className="my-4" />

                        <div>
                          <Label>Available Flavors</Label>
                          <div className="border rounded-md p-4 max-h-60 overflow-y-auto space-y-2">
                            {flavorsLoading ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="w-4 h-4 animate-spin" />
                              </div>
                            ) : (
                              allFlavors.map((flavor) => (
                                <div key={flavor.id} className="flex items-center space-x-2">
                                  <Checkbox
                                    id={`edit-flavor-${flavor.id}`}
                                    checked={wholesaleUnitTypeForm.availableFlavors.includes(flavor.id)}
                                    onCheckedChange={(checked) => {
                                      if (checked) {
                                        setWholesaleUnitTypeForm({
                                          ...wholesaleUnitTypeForm,
                                          availableFlavors: [...wholesaleUnitTypeForm.availableFlavors, flavor.id]
                                        });
                                      } else {
                                        setWholesaleUnitTypeForm({
                                          ...wholesaleUnitTypeForm,
                                          availableFlavors: wholesaleUnitTypeForm.availableFlavors.filter(id => id !== flavor.id)
                                        });
                                      }
                                    }}
                                    data-testid={`checkbox-edit-flavor-${flavor.id}`}
                                  />
                                  <Label htmlFor={`edit-flavor-${flavor.id}`} className="cursor-pointer">
                                    {flavor.name}
                                  </Label>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <Button
                          onClick={() => updateWholesaleUnitTypeMutation.mutate({ 
                            id: unitType.id, 
                            data: wholesaleUnitTypeForm,
                            pricing: customerPricing
                          })}
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
      </div>
    </StaffLayout>
  );
}
