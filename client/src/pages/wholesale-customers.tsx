import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleCustomer, insertWholesaleCustomerSchema, WholesaleLocation, insertWholesaleLocationSchema } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Mail, Phone, MapPin, Plus, Loader2, CreditCard, Users, Edit, X, FileDown, Upload } from "lucide-react";
import { StaffLayout } from "@/components/staff/staff-layout";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function WholesaleCustomers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<WholesaleCustomer | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [locationDialogOpen, setLocationDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<WholesaleLocation | null>(null);
  const [selectedCustomer, setSelectedCustomer] = useState<WholesaleCustomer | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [templateEmail, setTemplateEmail] = useState("casey@soundkombucha.com");
  const { toast } = useToast();

  const { data: customers, isLoading } = useQuery<WholesaleCustomer[]>({
    queryKey: ["/api/wholesale/customers"],
  });

  const form = useForm<z.infer<typeof insertWholesaleCustomerSchema>>({
    resolver: zodResolver(insertWholesaleCustomerSchema),
    defaultValues: {
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      allowOnlinePayment: false,
    },
  });

  const createCustomerMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertWholesaleCustomerSchema>) => {
      const response = await apiRequest("POST", "/api/wholesale/customers", data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Customer Created",
        description: "Wholesale customer has been created successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
      setDialogOpen(false);
      setEditingCustomer(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create customer",
        variant: "destructive",
      });
    },
  });

  const updateCustomerMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<z.infer<typeof insertWholesaleCustomerSchema>> }) => {
      const response = await apiRequest("PATCH", `/api/wholesale/customers/${id}`, data);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: "Customer Updated",
        description: "Wholesale customer has been updated successfully",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
      setDialogOpen(false);
      setEditingCustomer(null);
      form.reset();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update customer",
        variant: "destructive",
      });
    },
  });

  const handleCustomerSubmit = (data: z.infer<typeof insertWholesaleCustomerSchema>) => {
    if (editingCustomer) {
      updateCustomerMutation.mutate({ id: editingCustomer.id, data });
    } else {
      createCustomerMutation.mutate(data);
    }
  };

  const handleEditCustomer = (customer: WholesaleCustomer) => {
    setEditingCustomer(customer);
    form.reset({
      businessName: customer.businessName,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      allowOnlinePayment: customer.allowOnlinePayment,
    });
    setDialogOpen(true);
  };

  const handleAddNewCustomer = () => {
    setEditingCustomer(null);
    form.reset({
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
      address: "",
      allowOnlinePayment: false,
    });
    setDialogOpen(true);
  };

  const togglePaymentMutation = useMutation({
    mutationFn: async ({ id, allowOnlinePayment }: { id: string; allowOnlinePayment: boolean }) => {
      const response = await apiRequest("PATCH", `/api/wholesale/customers/${id}`, { allowOnlinePayment });
      return await response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
      toast({
        title: "Updated",
        description: "Payment settings updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update settings",
        variant: "destructive",
      });
    },
  });

  const updateEmailsMutation = useMutation({
    mutationFn: async ({ id, emails }: { id: string; emails: string[] }) => {
      return await apiRequest("PATCH", `/api/wholesale/customers/${id}`, { emails });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
      
      // Update the selectedCustomer to reflect the new emails immediately
      if (selectedCustomer && selectedCustomer.id === variables.id) {
        setSelectedCustomer({ ...selectedCustomer, emails: variables.emails });
      }
      
      toast({
        title: "Updated",
        description: "Authorized emails updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update emails",
        variant: "destructive",
      });
    },
  });

  const sendTemplateMutation = useMutation({
    mutationFn: async (email: string) => {
      return await apiRequest("POST", "/api/wholesale/customers/send-template", { email });
    },
    onSuccess: () => {
      toast({
        title: "Template Sent",
        description: "The CSV template has been sent to your email",
      });
      setTemplateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to send template",
        variant: "destructive",
      });
    },
  });

  const importCsvMutation = useMutation({
    mutationFn: async (csvData: any[]) => {
      return await apiRequest("POST", "/api/wholesale/customers/import", { csvData });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
      toast({
        title: "Import Complete",
        description: `Successfully imported ${data.imported} customer(s). ${data.failed} failed.`,
      });
      if (data.errors.length > 0) {
        console.error("Import errors:", data.errors);
      }
      setImportDialogOpen(false);
      setCsvFile(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import Failed",
        description: error.message || "Failed to import customers",
        variant: "destructive",
      });
    },
  });

  // Location query and mutations
  const { data: locations } = useQuery<WholesaleLocation[]>({
    queryKey: ["/api/wholesale/customers", selectedCustomer?.id, "locations"],
    enabled: !!selectedCustomer && locationDialogOpen,
  });

  const locationForm = useForm<z.infer<typeof insertWholesaleLocationSchema>>({
    resolver: zodResolver(insertWholesaleLocationSchema),
    defaultValues: {
      customerId: "",
      locationName: "",
      address: "",
      city: "",
      state: "",
      zipCode: "",
      contactName: "",
      contactPhone: "",
    },
  });

  const createLocationMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertWholesaleLocationSchema>) => {
      if (!selectedCustomer) throw new Error("No customer selected");
      return await apiRequest("POST", `/api/wholesale/customers/${selectedCustomer.id}/locations`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers", selectedCustomer?.id, "locations"] });
      toast({
        title: "Location Created",
        description: "Delivery location has been created successfully",
      });
      locationForm.reset();
      setEditingLocation(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create location",
        variant: "destructive",
      });
    },
  });

  const updateLocationMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<z.infer<typeof insertWholesaleLocationSchema>> }) => {
      if (!selectedCustomer) throw new Error("No customer selected");
      return await apiRequest("PATCH", `/api/wholesale/customers/${selectedCustomer.id}/locations/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers", selectedCustomer?.id, "locations"] });
      toast({
        title: "Location Updated",
        description: "Delivery location has been updated successfully",
      });
      locationForm.reset();
      setEditingLocation(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update location",
        variant: "destructive",
      });
    },
  });

  const deleteLocationMutation = useMutation({
    mutationFn: async (id: string) => {
      if (!selectedCustomer) throw new Error("No customer selected");
      await apiRequest("DELETE", `/api/wholesale/customers/${selectedCustomer.id}/locations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers", selectedCustomer?.id, "locations"] });
      toast({
        title: "Location Deleted",
        description: "Delivery location has been deleted successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete location",
        variant: "destructive",
      });
    },
  });

  const handleLocationSubmit = (data: z.infer<typeof insertWholesaleLocationSchema>) => {
    if (editingLocation) {
      updateLocationMutation.mutate({ id: editingLocation.id, data });
    } else {
      createLocationMutation.mutate({ ...data, customerId: selectedCustomer!.id });
    }
  };

  const handleEditLocation = (location: WholesaleLocation) => {
    setEditingLocation(location);
    locationForm.reset({
      customerId: location.customerId,
      locationName: location.locationName,
      address: location.address,
      city: location.city,
      state: location.state,
      zipCode: location.zipCode,
      contactName: location.contactName || "",
      contactPhone: location.contactPhone || "",
    });
  };

  const handleAddEmail = () => {
    if (!selectedCustomer || !newEmail) return;
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(newEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }

    const currentEmails = selectedCustomer.emails || [];
    if (currentEmails.includes(newEmail)) {
      toast({
        title: "Duplicate Email",
        description: "This email is already authorized",
        variant: "destructive",
      });
      return;
    }

    const updatedEmails = [...currentEmails, newEmail];
    updateEmailsMutation.mutate({ id: selectedCustomer.id, emails: updatedEmails });
    setNewEmail("");
  };

  const handleRemoveEmail = (email: string) => {
    if (!selectedCustomer) return;
    
    const currentEmails = selectedCustomer.emails || [];
    const updatedEmails = currentEmails.filter(e => e !== email);
    updateEmailsMutation.mutate({ id: selectedCustomer.id, emails: updatedEmails });
  };

  const onSubmit = (data: z.infer<typeof insertWholesaleCustomerSchema>) => {
    handleCustomerSubmit(data);
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;

    const text = await csvFile.text();
    const lines = text.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      toast({
        title: "Invalid CSV",
        description: "CSV file must have a header row and at least one data row",
        variant: "destructive",
      });
      return;
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const csvData = lines.slice(1).map(line => {
      // Simple CSV parsing (handles quoted values)
      const values = line.match(/(".*?"|[^",]+)(?=\s*,|\s*$)/g) || [];
      const row: any = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].replace(/^"|"$/g, '').trim() : '';
      });
      return row;
    });

    importCsvMutation.mutate(csvData);
  };

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
              Wholesale Customers
            </h1>
            <p className="text-muted-foreground">
              Manage wholesale customer accounts
            </p>
          </div>
          <div className="flex gap-2">
            <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-email-template">
                  <FileDown className="w-4 h-4 mr-2" />
                  Email Template
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Email CSV Template</DialogTitle>
                  <DialogDescription>
                    Send the wholesale customer import template to your email
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="template-email">Email Address</Label>
                    <Input
                      id="template-email"
                      type="email"
                      value={templateEmail}
                      onChange={(e) => setTemplateEmail(e.target.value)}
                      placeholder="your@email.com"
                      data-testid="input-template-email"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setTemplateDialogOpen(false)}
                    data-testid="button-cancel-template"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => sendTemplateMutation.mutate(templateEmail)}
                    disabled={sendTemplateMutation.isPending || !templateEmail}
                    data-testid="button-send-template"
                  >
                    {sendTemplateMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4 mr-2" />
                        Send Template
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" data-testid="button-import-csv">
                  <Upload className="w-4 h-4 mr-2" />
                  Import CSV
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import Wholesale Customers</DialogTitle>
                  <DialogDescription>
                    Upload a CSV file to bulk import wholesale customers
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="csv-file">CSV File</Label>
                    <Input
                      id="csv-file"
                      type="file"
                      accept=".csv"
                      onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                      data-testid="input-csv-file"
                    />
                    <p className="text-sm text-muted-foreground mt-2">
                      CSV must include columns: businessName, contactName, email, additionalEmails, phone, address, allowOnlinePayment. Optional location columns: locationName, locationAddress, locationCity, locationState, locationZipCode, locationContactName, locationContactPhone
                    </p>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setImportDialogOpen(false);
                      setCsvFile(null);
                    }}
                    data-testid="button-cancel-import"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleCsvImport}
                    disabled={importCsvMutation.isPending || !csvFile}
                    data-testid="button-confirm-import"
                  >
                    {importCsvMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Importing...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4 mr-2" />
                        Import Customers
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button onClick={handleAddNewCustomer} data-testid="button-add-customer">
              <Plus className="w-4 h-4 mr-2" />
              Add Customer
            </Button>

            <Dialog open={dialogOpen} onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) {
                setEditingCustomer(null);
                form.reset();
              }
            }}>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>{editingCustomer ? "Edit Wholesale Customer" : "Add Wholesale Customer"}</DialogTitle>
                  <DialogDescription>
                    {editingCustomer ? "Update the wholesale customer account details" : "Create a new wholesale customer account"}
                  </DialogDescription>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-business-name" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact Name</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-contact-name" />
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
                          <FormLabel>Primary Email</FormLabel>
                          <FormControl>
                            <Input type="email" {...field} data-testid="input-email" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-phone" />
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
                            <Textarea 
                              {...field} 
                              data-testid="input-address"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="allowOnlinePayment"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                          <div className="space-y-0.5">
                            <FormLabel>Allow Online Payment</FormLabel>
                            <p className="text-sm text-muted-foreground">
                              Enable this customer to pay online via Stripe
                            </p>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value}
                              onCheckedChange={field.onChange}
                              data-testid="switch-allow-online-payment"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                    <DialogFooter>
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => {
                          setDialogOpen(false);
                          setEditingCustomer(null);
                          form.reset();
                        }}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={createCustomerMutation.isPending || updateCustomerMutation.isPending}
                        data-testid="button-submit"
                      >
                        {(createCustomerMutation.isPending || updateCustomerMutation.isPending) ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {editingCustomer ? "Updating..." : "Creating..."}
                          </>
                        ) : (
                          editingCustomer ? "Update Customer" : "Create Customer"
                        )}
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
                <CardHeader>
                  <CardTitle style={{ fontFamily: 'var(--font-heading)' }}>Wholesale Customers</CardTitle>
                  <CardDescription>Manage your B2B customer relationships</CardDescription>
                </CardHeader>
                <CardContent>
                  {isLoading ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      {[1, 2].map((i) => (
                        <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
                      ))}
                    </div>
                  ) : customers && customers.length > 0 ? (
                    <div className="grid md:grid-cols-2 gap-4">
                      {customers.map((customer) => (
                        <Card key={customer.id} className="hover-elevate" data-testid={`customer-${customer.id}`}>
                          <CardHeader className="flex flex-row items-start justify-between gap-2">
                            <div>
                              <CardTitle className="text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
                                {customer.businessName}
                              </CardTitle>
                              <CardDescription>{customer.contactName}</CardDescription>
                            </div>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleEditCustomer(customer)}
                              data-testid={`button-edit-customer-${customer.id}`}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="w-4 h-4 text-muted-foreground" />
                              <span className="text-muted-foreground">{customer.email}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <Phone className="w-4 h-4 text-muted-foreground" />
                              <span className="text-muted-foreground">{customer.phone}</span>
                            </div>
                            <div className="space-y-3 pt-2 border-t">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <CreditCard className="w-4 h-4 text-muted-foreground" />
                                  <Label htmlFor={`payment-${customer.id}`} className="text-sm cursor-pointer">
                                    Allow Online Payment
                                  </Label>
                                </div>
                                <Switch
                                  id={`payment-${customer.id}`}
                                  checked={customer.allowOnlinePayment}
                                  onCheckedChange={(checked) => {
                                    togglePaymentMutation.mutate({ id: customer.id, allowOnlinePayment: checked });
                                  }}
                                  disabled={togglePaymentMutation.isPending}
                                  data-testid={`switch-payment-${customer.id}`}
                                />
                              </div>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  setSelectedCustomer(customer);
                                  setEmailDialogOpen(true);
                                }}
                                data-testid={`button-manage-emails-${customer.id}`}
                              >
                                <Mail className="w-4 h-4 mr-2" />
                                Manage Authorized Emails
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="w-full"
                                onClick={() => {
                                  setSelectedCustomer(customer);
                                  setEditingLocation(null);
                                  locationForm.reset({
                                    customerId: customer.id,
                                    locationName: "",
                                    address: "",
                                    city: "",
                                    state: "",
                                    zipCode: "",
                                    contactName: "",
                                    contactPhone: "",
                                  });
                                  setLocationDialogOpen(true);
                                }}
                                data-testid={`button-manage-locations-${customer.id}`}
                              >
                                <MapPin className="w-4 h-4 mr-2" />
                                Manage Locations
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-12">
                      <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                      <p className="text-muted-foreground">No customers yet</p>
                    </div>
                  )}
                </CardContent>
              </Card>
      </div>

      {/* Email Management Dialog */}
      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Manage Authorized Emails</DialogTitle>
            <DialogDescription>
              {selectedCustomer?.businessName} - Add or remove email addresses that can log into this wholesale account
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            {/* Primary Email (read-only) */}
            <div>
              <Label className="text-sm font-medium">Primary Email</Label>
              <div className="flex items-center gap-2 mt-2">
                <Badge variant="secondary" className="flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {selectedCustomer?.email}
                </Badge>
                <span className="text-xs text-muted-foreground">(Primary contact)</span>
              </div>
            </div>

            {/* Authorized Emails */}
            <div>
              <Label className="text-sm font-medium">Additional Authorized Emails</Label>
              <div className="mt-2 space-y-2">
                {selectedCustomer?.emails && selectedCustomer.emails.length > 0 ? (
                  selectedCustomer.emails.map((email) => (
                    <div key={email} className="flex items-center justify-between gap-2 p-2 border rounded-md">
                      <span className="text-sm">{email}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleRemoveEmail(email)}
                        disabled={updateEmailsMutation.isPending}
                        data-testid={`button-remove-email-${email}`}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No additional emails authorized</p>
                )}
              </div>
            </div>

            {/* Add New Email */}
            <div>
              <Label className="text-sm font-medium">Add New Email</Label>
              <div className="flex gap-2 mt-2">
                <Input
                  type="email"
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddEmail();
                    }
                  }}
                  data-testid="input-new-email"
                />
                <Button
                  onClick={handleAddEmail}
                  disabled={!newEmail || updateEmailsMutation.isPending}
                  data-testid="button-add-email"
                >
                  {updateEmailsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)} data-testid="button-close-email-dialog">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Location Management Dialog */}
      <Dialog open={locationDialogOpen} onOpenChange={(open) => {
        setLocationDialogOpen(open);
        if (!open) {
          setEditingLocation(null);
          locationForm.reset();
        }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manage Delivery Locations</DialogTitle>
            <DialogDescription>
              {selectedCustomer?.businessName} - Add or manage delivery locations for this customer
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Existing Locations */}
            {locations && locations.length > 0 && (
              <div>
                <Label className="text-sm font-medium">Existing Locations</Label>
                <div className="mt-2 space-y-2">
                  {locations.map((location) => (
                    <Card key={location.id} className="p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="font-medium">{location.locationName || '(No name)'}</div>
                          {(location.address || location.city || location.state || location.zipCode) ? (
                            <div className="text-sm text-muted-foreground mt-1">
                              {location.address && <div>{location.address}</div>}
                              {(location.city || location.state || location.zipCode) && (
                                <div>
                                  {[location.city, location.state].filter(Boolean).join(', ')}
                                  {location.zipCode && ` ${location.zipCode}`}
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-sm text-muted-foreground mt-1 italic">No address</div>
                          )}
                          {location.contactName && (
                            <div className="text-sm text-muted-foreground mt-2">
                              <div className="font-medium">Contact:</div>
                              <div>{location.contactName}</div>
                              {location.contactPhone && <div>{location.contactPhone}</div>}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleEditLocation(location)}
                            data-testid={`button-edit-location-${location.id}`}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this location?')) {
                                deleteLocationMutation.mutate(location.id);
                              }
                            }}
                            disabled={deleteLocationMutation.isPending}
                            data-testid={`button-delete-location-${location.id}`}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Add/Edit Location Form */}
            <div>
              <Label className="text-sm font-medium">
                {editingLocation ? 'Edit Location' : 'Add New Location'}
              </Label>
              <Form {...locationForm}>
                <form onSubmit={locationForm.handleSubmit(handleLocationSubmit)} className="space-y-4 mt-2">
                  <FormField
                    control={locationForm.control}
                    name="locationName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Location Name</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="Main Warehouse" data-testid="input-location-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={locationForm.control}
                    name="address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Street Address</FormLabel>
                        <FormControl>
                          <Input {...field} placeholder="123 Main St" data-testid="input-location-address" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={locationForm.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} placeholder="Seattle" data-testid="input-location-city" />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <FormField
                        control={locationForm.control}
                        name="state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="WA" maxLength={2} data-testid="input-location-state" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={locationForm.control}
                        name="zipCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP</FormLabel>
                            <FormControl>
                              <Input {...field} placeholder="98101" data-testid="input-location-zip" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <FormField
                    control={locationForm.control}
                    name="contactName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Name (Optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="John Smith" data-testid="input-location-contact-name" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={locationForm.control}
                    name="contactPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Contact Phone (Optional)</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value || ""} placeholder="206-555-0100" data-testid="input-location-contact-phone" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="flex gap-2">
                    {editingLocation && (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEditingLocation(null);
                          locationForm.reset({
                            customerId: selectedCustomer!.id,
                            locationName: "",
                            address: "",
                            city: "",
                            state: "",
                            zipCode: "",
                            contactName: "",
                            contactPhone: "",
                          });
                        }}
                        data-testid="button-cancel-edit-location"
                      >
                        Cancel Edit
                      </Button>
                    )}
                    <Button
                      type="submit"
                      disabled={createLocationMutation.isPending || updateLocationMutation.isPending}
                      data-testid="button-save-location"
                    >
                      {(createLocationMutation.isPending || updateLocationMutation.isPending) ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Plus className="w-4 h-4 mr-2" />
                          {editingLocation ? 'Update Location' : 'Add Location'}
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </Form>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLocationDialogOpen(false)} data-testid="button-close-location-dialog">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
