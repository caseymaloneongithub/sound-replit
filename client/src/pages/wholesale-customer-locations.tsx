import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import type { WholesaleLocation } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { WholesaleCustomerLayout } from "@/components/wholesale/wholesale-customer-layout";

const EMPTY = {
  locationName: "",
  address: "",
  city: "",
  state: "WA",
  zipCode: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  deliveryInstructions: "",
};

/**
 * Delivery locations, managed by the customer.
 *
 * The ownership-scoped API for this already existed but had no UI, so a multi-site
 * retailer had to email staff to add a store — and a customer with no address on file
 * could place an order that had nowhere to go.
 */
export default function WholesaleCustomerLocations() {
  const { toast } = useToast();
  const [editing, setEditing] = useState<WholesaleLocation | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WholesaleLocation | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const { data: locations = [], isLoading } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale-customer/locations"],
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/locations"] });
  };

  const closeDialog = () => {
    setCreating(false);
    setEditing(null);
    setForm({ ...EMPTY });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        contactName: form.contactName || undefined,
        contactPhone: form.contactPhone || undefined,
        contactEmail: form.contactEmail || undefined,
        deliveryInstructions: form.deliveryInstructions || undefined,
      };
      return editing
        ? apiRequest("PATCH", `/api/wholesale-customer/locations/${editing.id}`, payload)
        : apiRequest("POST", "/api/wholesale-customer/locations", payload);
    },
    onSuccess: () => {
      toast({
        title: editing ? "Location updated" : "Location added",
        description: editing
          ? `${form.locationName} has been updated.`
          : `${form.locationName} is now available when you place an order.`,
      });
      refresh();
      closeDialog();
    },
    onError: (error: any) => {
      toast({ title: "Couldn't save that", description: error.message, variant: "destructive" });
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/wholesale-customer/locations/${id}`),
    onSuccess: () => {
      toast({ title: "Location removed" });
      refresh();
      setDeleting(null);
    },
    onError: (error: any) => {
      toast({ title: "Couldn't remove that", description: error.message, variant: "destructive" });
      setDeleting(null);
    },
  });

  const openEdit = (loc: WholesaleLocation) => {
    setEditing(loc);
    setForm({
      locationName: loc.locationName,
      address: loc.address,
      city: loc.city,
      state: loc.state,
      zipCode: loc.zipCode,
      contactName: loc.contactName ?? "",
      contactPhone: loc.contactPhone ?? "",
      contactEmail: (loc as any).contactEmail ?? "",
      deliveryInstructions: loc.deliveryInstructions ?? "",
    });
  };

  const set = (key: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm({ ...form, [key]: e.target.value });

  const canSave =
    form.locationName.trim() !== "" &&
    form.address.trim() !== "" &&
    form.city.trim() !== "" &&
    form.state.trim() !== "" &&
    form.zipCode.trim() !== "";

  const dialogOpen = creating || editing !== null;

  return (
    <WholesaleCustomerLayout>
      <div className="py-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">Delivery Locations</h1>
            <p className="text-muted-foreground mt-1">
              Where we deliver your orders. Add a location and you can pick it at checkout.
            </p>
          </div>
          <Button onClick={() => { setForm({ ...EMPTY }); setCreating(true); }} data-testid="button-add-location">
            <Plus className="h-4 w-4 mr-2" />
            Add location
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        ) : locations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <p className="font-medium">No delivery locations yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-4">
                Add one so we know where to bring your order.
              </p>
              <Button onClick={() => { setForm({ ...EMPTY }); setCreating(true); }} data-testid="button-add-first-location">
                <Plus className="h-4 w-4 mr-2" />
                Add your first location
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {locations.map((loc) => (
              <Card key={loc.id} data-testid={`card-location-${loc.id}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      {loc.locationName}
                    </CardTitle>
                    {!loc.isActive && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    <p>{loc.address}</p>
                    {/* Some imported records have no city/state/zip; without this guard
                        the line renders as a lone comma. */}
                    {(loc.city || loc.state || loc.zipCode) && (
                      <p>
                        {[loc.city, loc.state].filter(Boolean).join(", ")}
                        {loc.zipCode ? ` ${loc.zipCode}` : ""}
                      </p>
                    )}
                    {!loc.city && !loc.zipCode && (
                      <p className="text-destructive mt-1">
                        Incomplete address — please add the city and ZIP.
                      </p>
                    )}
                  </div>
                  {(loc.contactName || loc.contactPhone) && (
                    <p className="text-sm text-muted-foreground">
                      {loc.contactName}
                      {loc.contactName && loc.contactPhone && " • "}
                      {loc.contactPhone}
                    </p>
                  )}
                  {loc.deliveryInstructions && (
                    <p className="text-sm text-muted-foreground italic">
                      "{loc.deliveryInstructions}"
                    </p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" size="sm" onClick={() => openEdit(loc)} data-testid={`button-edit-${loc.id}`}>
                      <Pencil className="h-3 w-3 mr-2" />
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting(loc)} data-testid={`button-delete-${loc.id}`}>
                      <Trash2 className="h-3 w-3 mr-2" />
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
          <DialogContent className="max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit location" : "Add a delivery location"}</DialogTitle>
              <DialogDescription>
                We'll use this address for deliveries. Contact details and instructions help
                our driver find you.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={(e) => { e.preventDefault(); if (canSave) save.mutate(); }}
            >
              <div className="space-y-2">
                <Label htmlFor="locationName">Location name *</Label>
                <Input id="locationName" value={form.locationName} onChange={set("locationName")}
                  placeholder="e.g. Main Store, Downtown" required data-testid="input-location-name" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Street address *</Label>
                <Input id="address" value={form.address} onChange={set("address")} required data-testid="input-address" />
              </div>

              <div className="grid gap-2 grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="city">City *</Label>
                  <Input id="city" value={form.city} onChange={set("city")} required data-testid="input-city" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="state">State *</Label>
                  <Input id="state" value={form.state} onChange={set("state")} required data-testid="input-state" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="zipCode">ZIP *</Label>
                  <Input id="zipCode" value={form.zipCode} onChange={set("zipCode")} required data-testid="input-zip" />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact name</Label>
                  <Input id="contactName" value={form.contactName} onChange={set("contactName")} data-testid="input-contact-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Contact phone</Label>
                  <Input id="contactPhone" type="tel" value={form.contactPhone} onChange={set("contactPhone")} data-testid="input-contact-phone" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="contactEmail">Invoice email</Label>
                <Input id="contactEmail" type="email" value={form.contactEmail} onChange={set("contactEmail")}
                  placeholder="Invoices for this location go here (account email otherwise)"
                  data-testid="input-contact-email" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="deliveryInstructions">Delivery instructions</Label>
                <Textarea id="deliveryInstructions" value={form.deliveryInstructions}
                  onChange={set("deliveryInstructions")} rows={2}
                  placeholder="e.g. Deliver to the back door before 10am, ask for the manager"
                  data-testid="input-delivery-instructions" />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeDialog}>Cancel</Button>
                <Button type="submit" disabled={!canSave || save.isPending} data-testid="button-save-location">
                  {save.isPending ? "Saving…" : editing ? "Save changes" : "Add location"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove {deleting?.locationName}?</AlertDialogTitle>
              <AlertDialogDescription>
                It won't be selectable for new orders. Past orders delivered here are not
                affected.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleting && remove.mutate(deleting.id)}
                data-testid="button-confirm-delete"
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </WholesaleCustomerLayout>
  );
}
