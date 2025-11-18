import { useState } from "react";
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
import { Loader2, Palette } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import type { Flavor } from "@shared/schema";

export default function AdminFlavors() {
  const { toast } = useToast();
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

  const { data: flavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
  });

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

  if (flavorsLoading) {
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
          <h1 className="text-4xl font-bold mb-2" data-testid="text-flavors-title">Flavor Library</h1>
          <p className="text-muted-foreground">
            Central repository of kombucha flavors used across retail and wholesale products
          </p>
        </div>

        <Card className="border-primary/30 mb-6">
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
      </div>
    </StaffLayout>
  );
}
