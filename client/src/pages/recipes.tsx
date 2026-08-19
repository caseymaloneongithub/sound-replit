import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus } from "lucide-react";
import type { Flavor } from "@shared/schema";

type BomLine = {
  id: string; materialId: string; units: string;
  materialTitle: string; materialUnit: string; materialCost: string;
};
type Recipe = {
  id: string; title: string; unit: string; standardBatch: string;
  flavorId: string | null; flavorName: string | null;
  finishedProductId: string | null; finishedProductName: string | null;
  materials: BomLine[];
};
type ProductLite = { id: string; name: string };
type MaterialLite = { id: string; title: string; unit: string };

const n = (v: string | number | null | undefined) => {
  const x = typeof v === "number" ? v : parseFloat(v ?? "0");
  return Number.isFinite(x) ? x : 0;
};
const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

function shortMaterial(title: string) {
  const idx = title.indexOf(":");
  return idx === -1 ? title : title.slice(idx + 1).trim();
}

function RecipeForm({ recipe, flavors, products, onClose }: {
  recipe?: Recipe; flavors: Flavor[]; products: ProductLite[]; onClose: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!recipe;
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [unit, setUnit] = useState(recipe?.unit ?? "case");
  const [standardBatch, setStandardBatch] = useState(recipe ? String(n(recipe.standardBatch)) : "1");
  const [flavorId, setFlavorId] = useState<string>(recipe?.flavorId ?? "none");
  const [finishedProductId, setFinishedProductId] = useState<string>(recipe?.finishedProductId ?? "none");

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title, unit,
        standardBatch: String(n(standardBatch)),
        flavorId: flavorId === "none" ? null : flavorId,
        finishedProductId: finishedProductId === "none" ? null : finishedProductId,
      };
      return isEdit
        ? apiRequest("PATCH", `/api/processes/${recipe!.id}`, body)
        : apiRequest("POST", "/api/processes", body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/processes"] });
      toast({ title: isEdit ? "Recipe updated" : "Recipe created" });
      onClose();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium">Title</label>
        <Input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Bottle:Sunbreak" data-testid="input-recipe-title" />
        <p className="text-xs text-muted-foreground">
          Convention: <code>Stage:Flavor</code> (e.g. <code>Bottle:Mist</code>, <code>Brew:Sunbreak</code>).
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Output unit</label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)}
            placeholder="case, gal" data-testid="input-recipe-unit" />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Standard batch</label>
          <Input type="number" step="0.01" min="0" value={standardBatch}
            onChange={(e) => setStandardBatch(e.target.value)} data-testid="input-recipe-batch" />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Flavor</label>
        <Select value={flavorId} onValueChange={setFlavorId}>
          <SelectTrigger data-testid="select-recipe-flavor">
            <SelectValue placeholder="Link to a flavor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None —</SelectItem>
            {flavors.map((f) => (
              <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Links this recipe to a flavor for dashboards.</p>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">Stocks finished product</label>
        <Select value={finishedProductId} onValueChange={setFinishedProductId}>
          <SelectTrigger data-testid="select-recipe-finished-product">
            <SelectValue placeholder="Finished product this batch yields" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">— None (intermediate step) —</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          When set, logging this recipe adds its output to the product's sellable stock.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} disabled={!title.trim() || !unit.trim() || save.isPending}
          data-testid="button-save-recipe">
          {save.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          {isEdit ? "Save changes" : "Create recipe"}
        </Button>
      </DialogFooter>
    </div>
  );
}

/** Add / adjust / remove the ingredient lines that a batch consumes. */
function BomEditor({ recipe, materials, onClose }: {
  recipe: Recipe; materials: MaterialLite[]; onClose: () => void;
}) {
  const { toast } = useToast();
  const [newMaterialId, setNewMaterialId] = useState("");
  const [newUnits, setNewUnits] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/processes"] });
  const fail = (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" });

  const addLine = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/processes/${recipe.id}/materials`, {
        materialId: newMaterialId,
        units: String(n(newUnits)),
      }),
    onSuccess: () => {
      invalidate();
      setNewMaterialId("");
      setNewUnits("");
      toast({ title: "Ingredient added" });
    },
    onError: fail,
  });

  const updateLine = useMutation({
    mutationFn: ({ id, units }: { id: string; units: string }) =>
      apiRequest("PATCH", `/api/process-materials/${id}`, { units }),
    onSuccess: invalidate,
    onError: fail,
  });

  const removeLine = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/process-materials/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Ingredient removed" }); },
    onError: fail,
  });

  // Materials not already on this recipe
  const available = materials.filter((m) => !recipe.materials.some((b) => b.materialId === m.id));

  return (
    <div className="space-y-4 py-2">
      <p className="text-xs text-muted-foreground">
        Quantities are per <strong>1 {recipe.unit}</strong> produced. Changes affect future
        batches only — stock already drawn by past productions is not adjusted.
      </p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Material</TableHead>
            <TableHead className="w-32 text-right">Qty / {recipe.unit}</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipe.materials.length === 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                No ingredients yet.
              </TableCell>
            </TableRow>
          )}
          {recipe.materials.map((m) => (
            <TableRow key={m.id} data-testid={`row-bom-${m.id}`}>
              <TableCell className="text-sm">
                {shortMaterial(m.materialTitle)}{" "}
                <span className="text-xs text-muted-foreground">({m.materialUnit})</span>
              </TableCell>
              <TableCell className="text-right">
                <Input
                  type="number" step="0.000001" min="0"
                  defaultValue={String(n(m.units))}
                  className="h-8 text-right"
                  onBlur={(e) => {
                    const v = String(n(e.target.value));
                    if (v !== String(n(m.units))) updateLine.mutate({ id: m.id, units: v });
                  }}
                  data-testid={`input-bom-units-${m.id}`}
                />
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive"
                  aria-label="Remove ingredient"
                  onClick={() => removeLine.mutate(m.id)}
                  data-testid={`button-bom-remove-${m.id}`}
                >
                  Remove
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex gap-2 items-end border-t pt-4">
        <div className="flex-1 space-y-1">
          <label className="text-xs font-medium">Add ingredient</label>
          <Select value={newMaterialId} onValueChange={setNewMaterialId}>
            <SelectTrigger data-testid="select-bom-material">
              <SelectValue placeholder="Select material" />
            </SelectTrigger>
            <SelectContent>
              {available.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {shortMaterial(m.title)} ({m.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Input
          className="w-28" type="number" step="0.000001" min="0" placeholder="Qty"
          value={newUnits} onChange={(e) => setNewUnits(e.target.value)}
          data-testid="input-bom-new-units"
        />
        <Button
          onClick={() => addLine.mutate()}
          disabled={!newMaterialId || n(newUnits) <= 0 || addLine.isPending}
          data-testid="button-bom-add"
        >
          {addLine.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Add"}
        </Button>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Done</Button>
      </DialogFooter>
    </div>
  );
}

export default function Recipes() {
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Recipe | null>(null);
  // Track by id so the editor always renders the freshest data after mutations
  const [bomRecipeId, setBomRecipeId] = useState<string | null>(null);

  const { data: recipes = [], isLoading } = useQuery<Recipe[]>({
    queryKey: ["/api/processes"],
  });
  const { data: flavors = [] } = useQuery<Flavor[]>({
    queryKey: ["/api/flavors"],
  });
  const { data: products = [] } = useQuery<ProductLite[]>({
    queryKey: ["/api/products"],
  });
  const { data: materials = [] } = useQuery<MaterialLite[]>({
    queryKey: ["/api/materials"],
  });

  const del = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/processes/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/processes"] });
      toast({ title: "Recipe deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const batchCost = (r: Recipe) =>
    r.materials.reduce((sum, m) => sum + n(m.units) * n(m.materialCost), 0);

  const sorted = useMemo(
    () => [...recipes].sort((a, b) => a.title.localeCompare(b.title)),
    [recipes]
  );

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
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-1" data-testid="text-recipes-title">Recipes</h1>
            <p className="text-muted-foreground">
              Each recipe's bill of materials — what a batch consumes per unit produced
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-create-recipe">
            <Plus className="w-4 h-4 mr-2" /> Add recipe
          </Button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {sorted.map((r) => (
            <Card key={r.id} data-testid={`card-recipe-${r.id}`}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {r.title}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Standard batch: {n(r.standardBatch).toLocaleString()} {r.unit}
                    </CardDescription>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {r.flavorName && <Badge variant="secondary">{r.flavorName}</Badge>}
                    {r.finishedProductName && (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 border-0 text-xs whitespace-nowrap">
                        → stocks {r.finishedProductName}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {r.materials.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">No materials defined for this recipe yet.</p>
                ) : (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Material</TableHead>
                          <TableHead className="text-right">Qty / {r.unit}</TableHead>
                          <TableHead className="text-right">Cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {r.materials.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell className="text-sm">{shortMaterial(m.materialTitle)}</TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {n(m.units).toLocaleString()} <span className="text-muted-foreground text-xs">{m.materialUnit}</span>
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-sm">
                              {money(n(m.units) * n(m.materialCost))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex items-center justify-between mt-3 pt-3 border-t">
                      <span className="text-sm font-medium">Material cost / {r.unit}</span>
                      <span className="text-sm font-bold tabular-nums" data-testid={`text-recipe-cost-${r.id}`}>
                        {money(batchCost(r))}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" size="sm" onClick={() => setEditing(r)}
                    data-testid={`button-edit-recipe-${r.id}`}>Edit</Button>
                  <Button variant="outline" size="sm" onClick={() => setBomRecipeId(r.id)}
                    data-testid={`button-edit-bom-${r.id}`}>Ingredients</Button>
                  <Button variant="ghost" size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { if (confirm(`Delete recipe "${r.title}"?`)) del.mutate(r.id); }}
                    data-testid={`button-delete-recipe-${r.id}`}>Delete</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add recipe</DialogTitle>
            <DialogDescription>Define a production or bottling recipe.</DialogDescription>
          </DialogHeader>
          <RecipeForm flavors={flavors} products={products} onClose={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit recipe</DialogTitle>
            <DialogDescription>{editing?.title}</DialogDescription>
          </DialogHeader>
          {editing && <RecipeForm recipe={editing} flavors={flavors} products={products} onClose={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={!!bomRecipeId} onOpenChange={(o) => !o && setBomRecipeId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Ingredients</DialogTitle>
            <DialogDescription>
              {sorted.find((r) => r.id === bomRecipeId)?.title}
            </DialogDescription>
          </DialogHeader>
          {(() => {
            const bomRecipe = sorted.find((r) => r.id === bomRecipeId);
            return bomRecipe ? (
              <BomEditor
                recipe={bomRecipe}
                materials={materials}
                onClose={() => setBomRecipeId(null)}
              />
            ) : null;
          })()}
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
