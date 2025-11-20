import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WholesaleCustomer, insertWholesaleCustomerSchema } from "@shared/schema";
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

export default function WholesaleCustomers() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
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
    createCustomerMutation.mutate(data);
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
                      CSV must include columns: businessName, contactName, email, additionalEmails, phone, address, allowOnlinePayment
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

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button data-testid="button-add-customer">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Customer
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Add Wholesale Customer</DialogTitle>
                  <DialogDescription>
                    Create a new wholesale customer account
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
                          <FormLabel>Email</FormLabel>
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
                    <DialogFooter>
                      <Button 
                        type="button" 
                        variant="outline" 
                        onClick={() => setDialogOpen(false)}
                        data-testid="button-cancel"
                      >
                        Cancel
                      </Button>
                      <Button 
                        type="submit" 
                        disabled={createCustomerMutation.isPending}
                        data-testid="button-submit"
                      >
                        {createCustomerMutation.isPending ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Creating...
                          </>
                        ) : (
                          "Create Customer"
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
                          <CardHeader>
                            <CardTitle className="text-lg" style={{ fontFamily: 'var(--font-heading)' }}>
                              {customer.businessName}
                            </CardTitle>
                            <CardDescription>{customer.contactName}</CardDescription>
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
                            <div className="flex items-start gap-2 text-sm">
                              <MapPin className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                              <span className="text-muted-foreground">{customer.address}</span>
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
    </StaffLayout>
  );
}
