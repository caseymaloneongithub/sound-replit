import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Palette, Upload, X, Image as ImageIcon } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { ObjectUploader } from "@/components/ObjectUploader";
import type { Flavor } from "@shared/schema";
import type { UploadResult } from "@uppy/core";

// Form schema with raw ingredients string (parsed on submit)
const flavorFormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().min(1, "Description is required"),
  flavorProfile: z.string().min(1, "Flavor profile is required"),
  ingredientsRaw: z.string().min(1, "Ingredients are required"),
  primaryImageUrl: z.string().optional(),
  secondaryImageUrl: z.string().optional(),
  isActive: z.boolean().default(true),
  displayOrder: z.coerce.number().int().min(0).default(0),
});

type FlavorFormValues = z.infer<typeof flavorFormSchema>;

function FlavorForm({ 
  flavor, 
  onClose, 
  isEdit = false 
}: { 
  flavor?: Flavor; 
  onClose: () => void; 
  isEdit?: boolean;
}) {
  const { toast } = useToast();
  const [primaryImageUrl, setPrimaryImageUrl] = useState(flavor?.primaryImageUrl || "");
  const [secondaryImageUrl, setSecondaryImageUrl] = useState(flavor?.secondaryImageUrl || "");

  const form = useForm<FlavorFormValues>({
    resolver: zodResolver(flavorFormSchema),
    defaultValues: {
      name: flavor?.name || "",
      description: flavor?.description || "",
      flavorProfile: flavor?.flavorProfile || "",
      ingredientsRaw: flavor?.ingredients?.join(", ") || "",
      primaryImageUrl: flavor?.primaryImageUrl || "",
      secondaryImageUrl: flavor?.secondaryImageUrl || "",
      isActive: flavor?.isActive ?? true,
      displayOrder: flavor?.displayOrder || 0,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('POST', '/api/flavors', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flavors'] });
      toast({ title: "Flavor created", description: "Flavor has been created successfully" });
      onClose();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to create flavor", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: any) => apiRequest('PATCH', `/api/flavors/${flavor?.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/flavors'] });
      toast({ title: "Flavor updated", description: "Flavor has been updated successfully" });
      onClose();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update flavor", variant: "destructive" });
    },
  });

  const handleGetUploadUrl = async (isSecondary = false) => {
    const filename = `flavor-${Date.now()}-${isSecondary ? 'secondary' : 'primary'}.jpg`;
    const response = await fetch('/api/object-storage/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, directory: 'public' }),
    });
    
    if (!response.ok) {
      throw new Error('Failed to get upload URL');
    }
    
    const data = await response.json();
    return {
      method: 'PUT' as const,
      url: data.uploadUrl,
    };
  };

  const handleUploadComplete = (result: UploadResult, isSecondary = false) => {
    if (result.successful.length > 0) {
      const uploadedFile = result.successful[0];
      const publicUrl = uploadedFile.uploadURL?.split('?')[0] || '';
      
      if (isSecondary) {
        setSecondaryImageUrl(publicUrl);
        form.setValue('secondaryImageUrl', publicUrl);
      } else {
        setPrimaryImageUrl(publicUrl);
        form.setValue('primaryImageUrl', publicUrl);
      }
      
      toast({ 
        title: "Image uploaded", 
        description: `${isSecondary ? 'Secondary' : 'Primary'} image uploaded successfully` 
      });
    }
  };

  const removeImage = (isSecondary = false) => {
    if (isSecondary) {
      setSecondaryImageUrl("");
      form.setValue('secondaryImageUrl', "");
    } else {
      setPrimaryImageUrl("");
      form.setValue('primaryImageUrl', "");
    }
  };

  const onSubmit = (values: FlavorFormValues) => {
    // Parse ingredients from comma-separated string to array
    const ingredients = values.ingredientsRaw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const submitData = {
      name: values.name,
      description: values.description,
      flavorProfile: values.flavorProfile,
      ingredients,
      primaryImageUrl: primaryImageUrl || undefined,
      secondaryImageUrl: secondaryImageUrl || undefined,
      isActive: values.isActive,
      displayOrder: values.displayOrder,
    };

    if (isEdit && flavor) {
      updateMutation.mutate(submitData);
    } else {
      createMutation.mutate(submitData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Flavor Name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g., Bonfire, Evergreen" data-testid="input-flavor-name" />
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
                <Textarea {...field} rows={3} data-testid="input-flavor-description" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="flavorProfile"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Flavor Profile</FormLabel>
              <FormControl>
                <Input {...field} placeholder="e.g., Bright, citrusy, refreshing" data-testid="input-flavor-profile" />
              </FormControl>
              <FormDescription>
                Brief description of taste characteristics
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="ingredientsRaw"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Ingredients</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  placeholder="e.g., Organic ginger root, lemon juice, turmeric" 
                  data-testid="input-flavor-ingredients" 
                />
              </FormControl>
              <FormDescription>
                Comma-separated list (spaces allowed)
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Primary Image Upload */}
        <div className="space-y-2">
          <FormLabel>Primary Image</FormLabel>
          {primaryImageUrl ? (
            <div className="relative inline-block">
              <img 
                src={primaryImageUrl} 
                alt="Primary" 
                className="w-32 h-32 object-cover rounded border"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                onClick={() => removeImage(false)}
                data-testid="button-remove-primary-image"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <ObjectUploader
              maxNumberOfFiles={1}
              onGetUploadParameters={() => handleGetUploadUrl(false)}
              onComplete={(result) => handleUploadComplete(result, false)}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Primary Image
            </ObjectUploader>
          )}
          <p className="text-sm text-muted-foreground">Main product photo</p>
        </div>

        {/* Secondary Image Upload */}
        <div className="space-y-2">
          <FormLabel>Secondary Image (Optional)</FormLabel>
          {secondaryImageUrl ? (
            <div className="relative inline-block">
              <img 
                src={secondaryImageUrl} 
                alt="Secondary" 
                className="w-32 h-32 object-cover rounded border"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-6 w-6 rounded-full"
                onClick={() => removeImage(true)}
                data-testid="button-remove-secondary-image"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ) : (
            <ObjectUploader
              maxNumberOfFiles={1}
              onGetUploadParameters={() => handleGetUploadUrl(true)}
              onComplete={(result) => handleUploadComplete(result, true)}
            >
              <Upload className="w-4 h-4 mr-2" />
              Upload Secondary Image
            </ObjectUploader>
          )}
          <p className="text-sm text-muted-foreground">Additional photo (optional)</p>
        </div>

        <FormField
          control={form.control}
          name="displayOrder"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display Order</FormLabel>
              <FormControl>
                <Input 
                  type="number" 
                  {...field} 
                  onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                  data-testid="input-flavor-order" 
                />
              </FormControl>
              <FormDescription>
                Lower numbers appear first
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-x-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-testid="input-flavor-active"
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Active</FormLabel>
                <FormDescription>
                  Inactive flavors are hidden from customers
                </FormDescription>
              </div>
            </FormItem>
          )}
        />

        <Button
          type="submit"
          disabled={isPending}
          className="w-full"
          data-testid={isEdit ? "button-update-flavor" : "button-save-flavor"}
        >
          {isPending ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {isEdit ? 'Saving...' : 'Creating...'}
            </>
          ) : (
            isEdit ? 'Save Changes' : 'Create Flavor'
          )}
        </Button>
      </form>
    </Form>
  );
}

export default function AdminFlavors() {
  const { toast } = useToast();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingFlavorId, setEditingFlavorId] = useState<string | null>(null);

  const { data: flavors = [], isLoading: flavorsLoading } = useQuery<Flavor[]>({
    queryKey: ['/api/flavors'],
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

  const editingFlavor = flavors.find(f => f.id === editingFlavorId);

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
            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-create-flavor">
                  Create Flavor
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New Flavor</DialogTitle>
                  <DialogDescription>Add a new kombucha flavor with image uploads</DialogDescription>
                </DialogHeader>
                <FlavorForm onClose={() => setCreateDialogOpen(false)} />
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
                <CardContent className="space-y-4">
                  {/* Images */}
                  {(flavor.primaryImageUrl || flavor.secondaryImageUrl) && (
                    <div className="flex gap-2">
                      {flavor.primaryImageUrl && (
                        <div className="relative">
                          <img 
                            src={flavor.primaryImageUrl} 
                            alt={`${flavor.name} primary`}
                            className="w-24 h-24 object-cover rounded border"
                          />
                          <Badge className="absolute bottom-1 left-1 text-xs">Primary</Badge>
                        </div>
                      )}
                      {flavor.secondaryImageUrl && (
                        <div className="relative">
                          <img 
                            src={flavor.secondaryImageUrl} 
                            alt={`${flavor.name} secondary`}
                            className="w-24 h-24 object-cover rounded border"
                          />
                          <Badge className="absolute bottom-1 left-1 text-xs">Secondary</Badge>
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-sm text-muted-foreground">{flavor.description}</p>
                  <p className="text-xs text-muted-foreground">
                    <strong>Ingredients:</strong> {flavor.ingredients.join(', ')}
                  </p>
                </CardContent>
                <CardFooter className="flex gap-2 flex-wrap">
                  <Dialog open={editingFlavorId === flavor.id} onOpenChange={(open) => !open && setEditingFlavorId(null)}>
                    <DialogTrigger asChild>
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={() => setEditingFlavorId(flavor.id)}
                        data-testid={`button-edit-flavor-${flavor.id}`}
                      >
                        Edit
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle>Edit {flavor.name}</DialogTitle>
                        <DialogDescription>Update flavor details and images</DialogDescription>
                      </DialogHeader>
                      {editingFlavor && (
                        <FlavorForm 
                          flavor={editingFlavor} 
                          onClose={() => setEditingFlavorId(null)} 
                          isEdit 
                        />
                      )}
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
