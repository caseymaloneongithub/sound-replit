import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { 
  Tags, 
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Loader2,
  FolderTree,
  EyeOff
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { AccountingCategory } from "@shared/schema";

const categoryFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(100),
  type: z.enum(['income', 'expense', 'transfer']),
  code: z.string().max(20).optional().nullable(),
  description: z.string().optional(),
  parentId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  excludeFromReports: z.boolean().optional(),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

export default function AccountingCategories() {
  const { toast } = useToast();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AccountingCategory | null>(null);

  const { data: categories = [], isLoading } = useQuery<AccountingCategory[]>({
    queryKey: ['/api/accounting/categories'],
  });

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: {
      name: "",
      type: "expense",
      code: "",
      description: "",
      parentId: null,
      isActive: true,
      excludeFromReports: false,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: CategoryFormData) => {
      return apiRequest('POST', '/api/accounting/categories', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/categories'] });
      toast({ title: "Category created successfully" });
      form.reset();
      setEditDialogOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create category", description: error.message, variant: "destructive" });
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: CategoryFormData }) => {
      return apiRequest('PATCH', `/api/accounting/categories/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/categories'] });
      toast({ title: "Category updated successfully" });
      setEditDialogOpen(false);
      setSelectedCategory(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update category", description: error.message, variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest('DELETE', `/api/accounting/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/accounting/categories'] });
      toast({ title: "Category deleted successfully" });
      setDeleteDialogOpen(false);
      setSelectedCategory(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete category", description: error.message, variant: "destructive" });
    }
  });

  const openCreateDialog = () => {
    setSelectedCategory(null);
    form.reset({
      name: "",
      type: "expense",
      code: "",
      description: "",
      parentId: null,
      isActive: true,
      excludeFromReports: false,
    });
    setEditDialogOpen(true);
  };

  const openEditDialog = (category: AccountingCategory) => {
    setSelectedCategory(category);
    form.reset({
      name: category.name,
      type: category.type as 'income' | 'expense' | 'transfer',
      code: category.code || "",
      description: category.description || "",
      parentId: category.parentId || null,
      isActive: category.isActive !== false,
      excludeFromReports: category.excludeFromReports || false,
    });
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (category: AccountingCategory) => {
    setSelectedCategory(category);
    setDeleteDialogOpen(true);
  };

  const onSubmit = (data: CategoryFormData) => {
    if (selectedCategory) {
      updateMutation.mutate({ id: selectedCategory.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleDelete = () => {
    if (selectedCategory) {
      deleteMutation.mutate(selectedCategory.id);
    }
  };

  const incomeCategories = categories.filter(c => c.type === 'income');
  const expenseCategories = categories.filter(c => c.type === 'expense');
  const transferCategories = categories.filter(c => c.type === 'transfer');

  const getParentName = (parentId: string | null) => {
    if (!parentId) return null;
    const parent = categories.find(c => c.id === parentId);
    return parent?.name;
  };

  const getChildCategories = (parentId: string) => {
    return categories.filter(c => c.parentId === parentId);
  };

  const CategoryCard = ({ category }: { category: AccountingCategory }) => {
    const children = getChildCategories(category.id);
    const parentName = getParentName(category.parentId);
    const isInactive = category.isActive === false;

    return (
      <Card key={category.id} className={`hover-elevate ${isInactive ? 'opacity-60' : ''}`}>
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h3 className="font-medium">{category.name}</h3>
                {category.code && (
                  <span className="text-xs text-muted-foreground font-mono">({category.code})</span>
                )}
                <Badge variant={category.type === 'income' ? 'default' : category.type === 'transfer' ? 'outline' : 'secondary'}>
                  {category.type}
                </Badge>
                {isInactive && (
                  <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
                )}
                {category.excludeFromReports && (
                  <EyeOff className="w-3 h-3 text-muted-foreground" title="Excluded from reports" />
                )}
              </div>
              {category.description && (
                <p className="text-sm text-muted-foreground mb-2">{category.description}</p>
              )}
              {parentName && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <FolderTree className="w-3 h-3" />
                  Parent: {parentName}
                </div>
              )}
              {children.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  {children.length} sub-categor{children.length > 1 ? 'ies' : 'y'}
                </div>
              )}
            </div>
            <div className="flex gap-1">
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => openEditDialog(category)}
                data-testid={`button-edit-category-${category.id}`}
              >
                <Pencil className="w-4 h-4" />
              </Button>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => openDeleteDialog(category)}
                data-testid={`button-delete-category-${category.id}`}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <StaffLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold" data-testid="heading-categories">
              Accounting Categories
            </h1>
            <p className="text-muted-foreground">
              Manage income and expense categories for financial reporting
            </p>
          </div>
          <Button onClick={openCreateDialog} data-testid="button-add-category">
            <Plus className="w-4 h-4 mr-2" />
            Add Category
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold">Income Categories</h2>
              <Badge variant="outline">{incomeCategories.length}</Badge>
            </div>
            
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-5 w-32 mb-2" />
                      <Skeleton className="h-4 w-48" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : incomeCategories.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No income categories yet. Create one to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {incomeCategories
                  .filter(c => !c.parentId)
                  .map((category) => (
                    <div key={category.id}>
                      <CategoryCard category={category} />
                      {getChildCategories(category.id).map((child) => (
                        <div key={child.id} className="ml-6 mt-2">
                          <CategoryCard category={child} />
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-red-600" />
              <h2 className="text-lg font-semibold">Expense Categories</h2>
              <Badge variant="outline">{expenseCategories.length}</Badge>
            </div>
            
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <Skeleton className="h-5 w-32 mb-2" />
                      <Skeleton className="h-4 w-48" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : expenseCategories.length === 0 ? (
              <Card>
                <CardContent className="p-6 text-center text-muted-foreground">
                  No expense categories yet. Create one to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {expenseCategories
                  .filter(c => !c.parentId)
                  .map((category) => (
                    <div key={category.id}>
                      <CategoryCard category={category} />
                      {getChildCategories(category.id).map((child) => (
                        <div key={child.id} className="ml-6 mt-2">
                          <CategoryCard category={child} />
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <ArrowLeftRight className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">Transfer Categories</h2>
            <Badge variant="outline">{transferCategories.length}</Badge>
          </div>
          
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(2)].map((_, i) => (
                <Card key={i}>
                  <CardContent className="p-4">
                    <Skeleton className="h-5 w-32 mb-2" />
                    <Skeleton className="h-4 w-48" />
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : transferCategories.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No transfer categories yet. Use transfers for moving money between accounts.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {transferCategories
                .filter(c => !c.parentId)
                .map((category) => (
                  <div key={category.id}>
                    <CategoryCard category={category} />
                    {getChildCategories(category.id).map((child) => (
                      <div key={child.id} className="ml-6 mt-2">
                        <CategoryCard category={child} />
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </div>

        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedCategory ? "Edit Category" : "Create Category"}
              </DialogTitle>
              <DialogDescription>
                {selectedCategory 
                  ? "Update the category details below."
                  : "Add a new category for organizing transactions."}
              </DialogDescription>
            </DialogHeader>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., Product Sales, Office Supplies" 
                          {...field} 
                          data-testid="input-category-name"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-category-type">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="income">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-4 h-4 text-green-600" />
                              Income
                            </div>
                          </SelectItem>
                          <SelectItem value="expense">
                            <div className="flex items-center gap-2">
                              <TrendingDown className="w-4 h-4 text-red-600" />
                              Expense
                            </div>
                          </SelectItem>
                          <SelectItem value="transfer">
                            <div className="flex items-center gap-2">
                              <ArrowLeftRight className="w-4 h-4 text-blue-600" />
                              Transfer
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="parentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Parent Category (Optional)</FormLabel>
                      <Select 
                        onValueChange={(val) => field.onChange(val === 'none' ? null : val)} 
                        value={field.value || 'none'}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-parent-category">
                            <SelectValue placeholder="No parent (top-level)" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="none">No parent (top-level)</SelectItem>
                          {categories
                            .filter(c => c.type === form.watch('type') && c.id !== selectedCategory?.id && !c.parentId)
                            .map((cat) => (
                              <SelectItem key={cat.id} value={cat.id}>
                                {cat.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        Organize categories hierarchically for detailed reporting
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Description (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Brief description of this category..."
                          className="resize-none"
                          {...field}
                          data-testid="input-category-description"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Code (Optional)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="e.g., 4000, COGS, OPS-01"
                          {...field}
                          value={field.value || ""}
                          data-testid="input-category-code"
                        />
                      </FormControl>
                      <FormDescription>
                        Short code for accounting systems or quick reference
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex items-center justify-between gap-4">
                  <FormField
                    control={form.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-3">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-category-active"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0">Active</FormLabel>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="excludeFromReports"
                    render={({ field }) => (
                      <FormItem className="flex items-center gap-2">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="checkbox-exclude-reports"
                          />
                        </FormControl>
                        <FormLabel className="!mt-0 text-sm">
                          <span className="flex items-center gap-1">
                            <EyeOff className="w-3 h-3" />
                            Exclude from reports
                          </span>
                        </FormLabel>
                      </FormItem>
                    )}
                  />
                </div>

                <DialogFooter>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setEditDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={createMutation.isPending || updateMutation.isPending}
                    data-testid="button-save-category"
                  >
                    {(createMutation.isPending || updateMutation.isPending) && (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    )}
                    {selectedCategory ? "Update" : "Create"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Category</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedCategory?.name}"? This action cannot be undone.
                Any transactions allocated to this category will become unallocated.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                onClick={handleDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-delete"
              >
                {deleteMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </StaffLayout>
  );
}
