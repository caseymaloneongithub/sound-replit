import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, FileText, MapPin, Calendar, Plus, Edit, Trash2 } from "lucide-react";
import { useLocation } from "wouter";
import { format } from "date-fns";
import type { WholesaleCustomer, WholesaleLocation, InsertWholesaleLocation } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertWholesaleLocationSchema } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type WholesaleOrder = {
  id: string;
  invoiceNumber: string;
  orderDate: string;
  deliveryDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string;
    productName: string;
  }>;
};

function LocationDialog({ location, onSuccess }: { location?: WholesaleLocation; onSuccess: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<Omit<InsertWholesaleLocation, 'customerId'>>({
    resolver: zodResolver(insertWholesaleLocationSchema.omit({ customerId: true })),
    defaultValues: location ? {
      locationName: location.locationName,
      address: location.address,
      city: location.city,
      state: location.state,
      zipCode: location.zipCode,
      contactName: location.contactName || "",
      contactPhone: location.contactPhone || "",
    } : {
      locationName: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      contactName: "",
      contactPhone: "",
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: Omit<InsertWholesaleLocation, 'customerId'>) => {
      return await apiRequest("POST", "/api/wholesale-customer/locations", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/locations"] });
      toast({ title: "Location created successfully" });
      setOpen(false);
      form.reset();
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error creating location", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: Partial<Omit<InsertWholesaleLocation, 'customerId'>>) => {
      return await apiRequest("PATCH", `/api/wholesale-customer/locations/${location?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/locations"] });
      toast({ title: "Location updated successfully" });
      setOpen(false);
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Error updating location", description: error.message, variant: "destructive" });
    },
  });

  const onSubmit = (data: Omit<InsertWholesaleLocation, 'customerId'>) => {
    if (location) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {location ? (
          <Button variant="ghost" size="icon" data-testid={`button-edit-location-${location.id}`}>
            <Edit className="h-4 w-4" />
          </Button>
        ) : (
          <Button data-testid="button-add-location">
            <Plus className="mr-2 h-4 w-4" />
            Add Location
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{location ? "Edit Location" : "Add New Location"}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="locationName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Location Name</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Main Office" data-testid="input-location-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="123 Main St" data-testid="input-address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Seattle" data-testid="input-city" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="WA" data-testid="input-state" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="zipCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Zip Code</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="98101" data-testid="input-zip" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="contactName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Name</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} placeholder="John Doe" data-testid="input-contact-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactPhone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contact Phone</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} placeholder="(206) 555-1234" data-testid="input-contact-phone" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} data-testid="button-cancel">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} data-testid="button-save-location">
                {isPending ? "Saving..." : location ? "Update Location" : "Add Location"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteLocationDialog({ locationId, locationName }: { locationId: string; locationName: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/wholesale-customer/locations/${locationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale-customer/locations"] });
      toast({ title: "Location deleted successfully" });
      setOpen(false);
    },
    onError: (error: Error) => {
      toast({ title: "Error deleting location", description: error.message, variant: "destructive" });
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button 
        variant="ghost" 
        size="icon" 
        onClick={() => setOpen(true)}
        data-testid={`button-delete-location-${locationId}`}
      >
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Location</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete "{locationName}"? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => deleteMutation.mutate()}
            disabled={deleteMutation.isPending}
            data-testid="button-confirm-delete"
          >
            {deleteMutation.isPending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function WholesaleCustomerDashboard() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const { data: customer, isLoading: customerLoading } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  const { data: orders, isLoading: ordersLoading } = useQuery<WholesaleOrder[]>({
    queryKey: ["/api/wholesale-customer/orders"],
  });

  const { data: locations, isLoading: locationsLoading } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale-customer/locations"],
  });

  const isLoading = customerLoading || ordersLoading || locationsLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const pendingOrders = orders?.filter(o => o.status === 'pending') || [];
  const packagedOrders = orders?.filter(o => o.status === 'packaged') || [];
  const deliveredOrders = orders?.filter(o => o.status === 'delivered') || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold" data-testid="text-page-title">
              {customer?.businessName ? `${customer.businessName} - Wholesale Dashboard` : 'Wholesale Dashboard'}
            </h1>
            <p className="text-muted-foreground mt-1">Manage your wholesale orders and view history</p>
          </div>
          <Button 
            onClick={() => setLocation('/wholesale-customer/place-order')}
            data-testid="button-place-order"
          >
            <Package className="mr-2 h-4 w-4" />
            Place New Order
          </Button>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending Orders</CardTitle>
              <Calendar className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-pending-count">{pendingOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Packaged</CardTitle>
              <Package className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-packaged-count">{packagedOrders.length}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-1 space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delivered</CardTitle>
              <MapPin className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold" data-testid="text-delivered-count">{deliveredOrders.length}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Orders</CardTitle>
          </CardHeader>
          <CardContent>
            {!orders || orders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No orders yet</p>
                <p className="text-sm mt-2">Place your first order to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-4 border rounded-md hover-elevate"
                    data-testid={`card-order-${order.id}`}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium" data-testid={`text-invoice-${order.id}`}>
                          {order.invoiceNumber}
                        </p>
                        <span
                          className={`text-xs px-2 py-1 rounded ${
                            order.status === 'pending' ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
                            order.status === 'processing' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' :
                            order.status === 'shipped' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200' :
                            'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                          }`}
                          data-testid={`status-${order.id}`}
                        >
                          {order.status}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Ordered: {format(new Date(order.orderDate), 'MMM dd, yyyy')}
                      </p>
                      {order.deliveryDate && (
                        <p className="text-sm text-muted-foreground">
                          Delivery: {format(new Date(order.deliveryDate), 'MMM dd, yyyy')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-semibold" data-testid={`text-total-${order.id}`}>
                          ${parseFloat(order.totalAmount).toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(`/wholesale/invoice/${order.id}`, '_blank')}
                        data-testid={`button-view-invoice-${order.id}`}
                      >
                        <FileText className="h-4 w-4 mr-2" />
                        View Invoice
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-1">
            <CardTitle>Delivery Locations</CardTitle>
            <LocationDialog onSuccess={() => {}} />
          </CardHeader>
          <CardContent>
            {!locations || locations.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <MapPin className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No delivery locations yet</p>
                <p className="text-sm mt-2">Add a location to streamline your orders</p>
              </div>
            ) : (
              <div className="space-y-4">
                {locations.map((location) => (
                  <div
                    key={location.id}
                    className="flex items-start justify-between p-4 border rounded-md"
                    data-testid={`card-location-${location.id}`}
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        <p className="font-medium" data-testid={`text-location-name-${location.id}`}>
                          {location.locationName}
                        </p>
                      </div>
                      <p className="text-sm text-muted-foreground ml-6" data-testid={`text-address-${location.id}`}>
                        {location.address}
                      </p>
                      <p className="text-sm text-muted-foreground ml-6">
                        {location.city}, {location.state} {location.zipCode}
                      </p>
                      <p className="text-sm text-muted-foreground ml-6">
                        Contact: {location.contactName} • {location.contactPhone}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <LocationDialog location={location} onSuccess={() => {}} />
                      <DeleteLocationDialog locationId={location.id} locationName={location.locationName} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
