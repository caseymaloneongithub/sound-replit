import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import type { Subscription, UpdateProfile } from "@shared/schema";
import { updateProfileSchema } from "@shared/schema";
import { Loader2, Calendar, Package, User, LogOut, Edit, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PickupInfo } from "@/components/pickup-info";

export default function Account() {
  const { toast } = useToast();
  const { user, isLoading, logoutMutation } = useAuth();
  const [, setLocation] = useLocation();
  const [editDialogOpen, setEditDialogOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation('/auth');
    }
  }, [user, isLoading, setLocation]);

  const form = useForm<UpdateProfile>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: user?.firstName || "",
      lastName: user?.lastName || "",
      email: user?.email || "",
      phoneNumber: user?.phoneNumber || "",
    },
  });

  // Update form when user data changes
  useEffect(() => {
    if (user) {
      form.reset({
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
        phoneNumber: user.phoneNumber || "",
      });
    }
  }, [user, form]);

  const updateProfileMutation = useMutation({
    mutationFn: async (data: UpdateProfile) => {
      return await apiRequest("PATCH", "/api/update-profile", data);
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Your profile has been updated successfully.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      setEditDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update profile",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateProfile) => {
    updateProfileMutation.mutate(data);
  };

  const { data: subscriptions, isLoading: subscriptionsLoading } = useQuery<Subscription[]>({
    queryKey: ["/api/my-subscriptions"],
    enabled: !!user,
  });

  const createBillingPortalMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", "/api/create-billing-portal", {});
    },
    onSuccess: (data: { url: string }) => {
      // Open Stripe billing portal in new tab
      window.open(data.url, '_blank');
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to open billing portal",
        variant: "destructive",
      });
    },
  });

  if (isLoading || subscriptionsLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) return null;

  const activeSubscriptions = subscriptions?.filter(s => s.status === 'active') || [];

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2" data-testid="text-account-title">My Account</h1>
            <p className="text-muted-foreground">Manage your profile and payment settings</p>
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await logoutMutation.mutateAsync();
              setLocation('/auth');
            }}
            disabled={logoutMutation.isPending}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 mr-2" />
            {logoutMutation.isPending ? 'Logging out...' : 'Log Out'}
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card data-testid="card-profile">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5" />
                  Profile
                </CardTitle>
                <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-edit-profile">
                      <Edit className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent data-testid="dialog-edit-profile">
                    <DialogHeader>
                      <DialogTitle>Edit Profile</DialogTitle>
                      <DialogDescription>
                        Update your contact information
                      </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                        <FormField
                          control={form.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>First Name</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Enter first name"
                                  data-testid="input-first-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Last Name</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  placeholder="Enter last name"
                                  data-testid="input-last-name"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="email"
                                  placeholder="Enter email address"
                                  data-testid="input-email"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="phoneNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Phone Number</FormLabel>
                              <FormControl>
                                <Input 
                                  {...field} 
                                  type="tel"
                                  placeholder="Enter phone number"
                                  data-testid="input-phone"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <div className="flex gap-2 justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditDialogOpen(false)}
                            disabled={updateProfileMutation.isPending}
                            data-testid="button-cancel"
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            disabled={updateProfileMutation.isPending}
                            data-testid="button-save-profile"
                          >
                            {updateProfileMutation.isPending ? (
                              <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Saving...
                              </>
                            ) : (
                              "Save Changes"
                            )}
                          </Button>
                        </div>
                      </form>
                    </Form>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Name</p>
                <p className="font-medium" data-testid="text-user-name">
                  {user.firstName && user.lastName
                    ? `${user.firstName} ${user.lastName}`
                    : user.firstName || user.lastName || 'Not provided'}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Username</p>
                <p className="font-medium" data-testid="text-user-username">{user.username}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Email</p>
                <p className="font-medium" data-testid="text-user-email">{user.email || 'Not provided'}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Phone</p>
                <p className="font-medium" data-testid="text-user-phone">{user.phoneNumber || 'Not provided'}</p>
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-subscription-summary">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="w-5 h-5" />
                Active Subscriptions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold" data-testid="text-active-count">
                {activeSubscriptions.length}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {activeSubscriptions.length === 1 ? 'subscription' : 'subscriptions'}
              </p>
            </CardContent>
          </Card>

          <Card data-testid="card-next-pickup">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                Next Pickup
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeSubscriptions.length > 0 && activeSubscriptions[0].nextDeliveryDate ? (
                <>
                  <div className="text-2xl font-bold" data-testid="text-next-pickup">
                    {format(new Date(activeSubscriptions[0].nextDeliveryDate!), 'MMM d, yyyy')}
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">
                    {format(new Date(activeSubscriptions[0].nextDeliveryDate!), 'EEEE')}
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">No upcoming pickups</p>
              )}
            </CardContent>
          </Card>
          <Card data-testid="card-payment-method">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="w-5 h-5" />
                Payment Method
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Manage your payment methods and billing information through Stripe's secure portal.
              </p>
              <Button 
                onClick={() => createBillingPortalMutation.mutate()}
                disabled={createBillingPortalMutation.isPending || !user.stripeCustomerId}
                data-testid="button-update-payment-method"
                className="w-full"
              >
                {createBillingPortalMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Opening...
                  </>
                ) : (
                  <>
                    <CreditCard className="w-4 h-4 mr-2" />
                    Update Payment Method
                  </>
                )}
              </Button>
              {!user.stripeCustomerId && (
                <p className="text-sm text-muted-foreground mt-2">
                  You need to have an active subscription to manage payment methods.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {activeSubscriptions.length > 0 && (
          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Pickup Information</h2>
            <PickupInfo />
          </div>
        )}
      </div>
    </div>
  );
}
