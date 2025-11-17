import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Search, Phone, Mail, Building2, User, Calendar, MessageSquare, Pencil, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { insertLeadSchema, insertLeadTouchPointSchema, type Lead, type LeadTouchPoint } from "@shared/schema";
import { z } from "zod";

const priorityColors: Record<string, string> = {
  low: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  high: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const statusColors: Record<string, string> = {
  new: "bg-purple-500/10 text-purple-700 dark:text-purple-300",
  contacted: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  qualified: "bg-green-500/10 text-green-700 dark:text-green-300",
  proposal: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
  negotiation: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
  won: "bg-green-600/10 text-green-700 dark:text-green-300",
  lost: "bg-gray-500/10 text-gray-700 dark:text-gray-300",
};

export default function CRMPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isTouchPointDialogOpen, setIsTouchPointDialogOpen] = useState(false);

  // Fetch leads
  const { data: leads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/crm/leads", statusFilter, priorityFilter],
    enabled: searchQuery === "",
  });

  // Fetch search results - using default fetcher with query params in query key
  const { data: searchResults = [], isLoading: isSearching } = useQuery<Lead[]>({
    queryKey: ["/api/crm/leads/search", { q: searchQuery }],
    enabled: searchQuery.length > 0,
  });

  // Fetch touch points for selected lead
  const { data: touchPoints = [] } = useQuery<LeadTouchPoint[]>({
    queryKey: selectedLead ? ["/api/crm/leads", selectedLead.id, "touchpoints"] : ["disabled"],
    enabled: !!selectedLead?.id,
  });

  // Create lead mutation
  const createLeadMutation = useMutation({
    mutationFn: async (data: z.infer<typeof insertLeadSchema>) => 
      await apiRequest("POST", "/api/crm/leads", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Lead created successfully" });
      setIsCreateDialogOpen(false);
      createForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update lead mutation
  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<z.infer<typeof insertLeadSchema>> }) =>
      await apiRequest("PATCH", `/api/crm/leads/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Lead updated successfully" });
      setIsEditDialogOpen(false);
      setSelectedLead(null);
      editForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Create touch point mutation
  const createTouchPointMutation = useMutation({
    mutationFn: async ({ leadId, data }: { leadId: string; data: Omit<z.infer<typeof insertLeadTouchPointSchema>, 'leadId' | 'createdByUserId'> }) =>
      await apiRequest("POST", `/api/crm/leads/${leadId}/touchpoints`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Touch point added successfully" });
      setIsTouchPointDialogOpen(false);
      touchPointForm.reset();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Delete lead mutation
  const deleteLeadMutation = useMutation({
    mutationFn: async (id: string) => await apiRequest("DELETE", `/api/crm/leads/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Lead deleted successfully" });
      setSelectedLead(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Create lead form
  const createForm = useForm<z.infer<typeof insertLeadSchema>>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
      priorityLevel: "medium",
      status: "new",
      notes: "",
    },
  });

  // Edit lead form
  const editForm = useForm<z.infer<typeof insertLeadSchema>>({
    resolver: zodResolver(insertLeadSchema),
    defaultValues: {
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
      priorityLevel: "medium",
      status: "new",
      notes: "",
    },
  });

  // Touch point form
  const touchPointForm = useForm<Omit<z.infer<typeof insertLeadTouchPointSchema>, 'leadId' | 'createdByUserId'>>({
    resolver: zodResolver(insertLeadTouchPointSchema.omit({ leadId: true, createdByUserId: true })),
    defaultValues: {
      type: "note",
      subject: "",
      notes: "",
    },
  });

  const displayedLeads = searchQuery ? searchResults : leads.filter((lead) => {
    if (statusFilter !== "all" && lead.status !== statusFilter) return false;
    if (priorityFilter !== "all" && lead.priorityLevel !== priorityFilter) return false;
    return true;
  });

  const handleCreateLead = (values: z.infer<typeof insertLeadSchema>) => {
    createLeadMutation.mutate(values);
  };

  const handleUpdateLead = (values: z.infer<typeof insertLeadSchema>) => {
    if (!selectedLead) return;
    updateLeadMutation.mutate({ id: selectedLead.id, data: values });
  };

  const handleAddTouchPoint = (values: Omit<z.infer<typeof insertLeadTouchPointSchema>, 'leadId' | 'createdByUserId'>) => {
    if (!selectedLead) return;
    createTouchPointMutation.mutate({ leadId: selectedLead.id, data: values });
  };

  // Sync edit form when selected lead changes
  useEffect(() => {
    if (selectedLead && isEditDialogOpen) {
      editForm.reset({
        businessName: selectedLead.businessName,
        contactName: selectedLead.contactName,
        email: selectedLead.email || "",
        phone: selectedLead.phone || "",
        priorityLevel: selectedLead.priorityLevel,
        status: selectedLead.status,
        notes: selectedLead.notes || "",
      });
    }
  }, [selectedLead, isEditDialogOpen]);

  const openEditDialog = (lead: Lead) => {
    setSelectedLead(lead);
    editForm.reset({
      businessName: lead.businessName,
      contactName: lead.contactName,
      email: lead.email || "",
      phone: lead.phone || "",
      priorityLevel: lead.priorityLevel,
      status: lead.status,
      notes: lead.notes || "",
    });
    setIsEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold" data-testid="heading-crm">CRM - Lead Management</h2>
          <p className="text-muted-foreground" data-testid="text-crm-description">Track and manage potential customers</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-lead">
              <Plus className="w-4 h-4 mr-2" />
              New Lead
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(handleCreateLead)}>
                <DialogHeader>
                  <DialogTitle data-testid="title-create-lead">Create New Lead</DialogTitle>
                  <DialogDescription data-testid="description-create-lead">Add a new potential customer to your CRM</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-business-name" />
                          </FormControl>
                          <FormMessage data-testid="error-business-name" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-contact-name" />
                          </FormControl>
                          <FormMessage data-testid="error-contact-name" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" data-testid="input-email" />
                          </FormControl>
                          <FormMessage data-testid="error-email" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} type="tel" data-testid="input-phone" />
                          </FormControl>
                          <FormMessage data-testid="error-phone" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="priorityLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority Level</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-priority">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low" data-testid="option-priority-low">Low</SelectItem>
                              <SelectItem value="medium" data-testid="option-priority-medium">Medium</SelectItem>
                              <SelectItem value="high" data-testid="option-priority-high">High</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-priority" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-status">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="new" data-testid="option-status-new">New</SelectItem>
                              <SelectItem value="contacted" data-testid="option-status-contacted">Contacted</SelectItem>
                              <SelectItem value="qualified" data-testid="option-status-qualified">Qualified</SelectItem>
                              <SelectItem value="proposal" data-testid="option-status-proposal">Proposal</SelectItem>
                              <SelectItem value="negotiation" data-testid="option-status-negotiation">Negotiation</SelectItem>
                              <SelectItem value="won" data-testid="option-status-won">Won</SelectItem>
                              <SelectItem value="lost" data-testid="option-status-lost">Lost</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-status" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={createForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} data-testid="input-notes" />
                        </FormControl>
                        <FormMessage data-testid="error-notes" />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createLeadMutation.isPending} data-testid="button-submit-create">
                    {createLeadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Create Lead
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="title-filter-section">Filter & Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label data-testid="label-search">Search</Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, phone..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                  data-testid="input-search"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label data-testid="label-status-filter">Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-filter-status-all">All Statuses</SelectItem>
                  <SelectItem value="new" data-testid="option-filter-status-new">New</SelectItem>
                  <SelectItem value="contacted" data-testid="option-filter-status-contacted">Contacted</SelectItem>
                  <SelectItem value="qualified" data-testid="option-filter-status-qualified">Qualified</SelectItem>
                  <SelectItem value="proposal" data-testid="option-filter-status-proposal">Proposal</SelectItem>
                  <SelectItem value="negotiation" data-testid="option-filter-status-negotiation">Negotiation</SelectItem>
                  <SelectItem value="won" data-testid="option-filter-status-won">Won</SelectItem>
                  <SelectItem value="lost" data-testid="option-filter-status-lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label data-testid="label-priority-filter">Priority</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger data-testid="select-priority-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" data-testid="option-filter-priority-all">All Priorities</SelectItem>
                  <SelectItem value="low" data-testid="option-filter-priority-low">Low</SelectItem>
                  <SelectItem value="medium" data-testid="option-filter-priority-medium">Medium</SelectItem>
                  <SelectItem value="high" data-testid="option-filter-priority-high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {(isLoading || isSearching) ? (
        <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-leads">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-muted-foreground">Loading leads...</span>
        </div>
      ) : displayedLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" data-testid="icon-no-leads" />
            <p className="text-muted-foreground" data-testid="text-no-leads">No leads found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {displayedLeads.map((lead) => (
            <Card
              key={lead.id}
              className="hover-elevate cursor-pointer"
              onClick={() => setSelectedLead(lead)}
              data-testid={`card-lead-${lead.id}`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="text-lg font-semibold" data-testid={`text-business-name-${lead.id}`}>
                        {lead.businessName}
                      </h3>
                      <Badge className={priorityColors[lead.priorityLevel]} data-testid={`badge-priority-${lead.id}`}>
                        {lead.priorityLevel}
                      </Badge>
                      <Badge className={statusColors[lead.status]} data-testid={`badge-status-${lead.id}`}>
                        {lead.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-2" data-testid={`text-contact-${lead.id}`}>
                        <User className="w-4 h-4" />
                        <span>{lead.contactName}</span>
                      </div>
                      {lead.email && (
                        <div className="flex items-center gap-2" data-testid={`text-email-${lead.id}`}>
                          <Mail className="w-4 h-4" />
                          <span>{lead.email}</span>
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-2" data-testid={`text-phone-${lead.id}`}>
                          <Phone className="w-4 h-4" />
                          <span>{lead.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2" data-testid={`text-created-${lead.id}`}>
                        <Calendar className="w-4 h-4" />
                        <span>Created {format(new Date(lead.createdAt), "MMM d, yyyy")}</span>
                      </div>
                    </div>
                    {lead.notes && (
                      <p className="text-sm text-muted-foreground line-clamp-2" data-testid={`text-notes-preview-${lead.id}`}>{lead.notes}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead && !isEditDialogOpen && !isTouchPointDialogOpen} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <DialogTitle className="text-2xl" data-testid="title-lead-detail">{selectedLead.businessName}</DialogTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={priorityColors[selectedLead.priorityLevel]} data-testid="badge-detail-priority">
                        {selectedLead.priorityLevel}
                      </Badge>
                      <Badge className={statusColors[selectedLead.status]} data-testid="badge-detail-status">
                        {selectedLead.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => openEditDialog(selectedLead)}
                      data-testid="button-edit-lead"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        if (confirm("Are you sure you want to delete this lead?")) {
                          deleteLeadMutation.mutate(selectedLead.id);
                        }
                      }}
                      data-testid="button-delete-lead"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-6">
                <div className="grid gap-4">
                  <div>
                    <h4 className="text-sm font-semibold mb-2" data-testid="heading-contact-info">Contact Information</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2" data-testid="text-detail-contact">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedLead.contactName}</span>
                      </div>
                      {selectedLead.email && (
                        <div className="flex items-center gap-2" data-testid="text-detail-email">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <a href={`mailto:${selectedLead.email}`} className="text-primary hover:underline">
                            {selectedLead.email}
                          </a>
                        </div>
                      )}
                      {selectedLead.phone && (
                        <div className="flex items-center gap-2" data-testid="text-detail-phone">
                          <Phone className="w-4 h-4 text-muted-foreground" />
                          <a href={`tel:${selectedLead.phone}`} className="text-primary hover:underline">
                            {selectedLead.phone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedLead.notes && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2" data-testid="heading-notes">Notes</h4>
                      <p className="text-sm text-muted-foreground" data-testid="text-detail-notes">{selectedLead.notes}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold" data-testid="heading-touchpoints">Touch Point History</h4>
                    <Button
                      size="sm"
                      onClick={() => setIsTouchPointDialogOpen(true)}
                      data-testid="button-add-touchpoint"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      Add Touch Point
                    </Button>
                  </div>
                  {touchPoints.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-touchpoints">No touch points yet</p>
                  ) : (
                    <div className="space-y-3">
                      {touchPoints.map((tp) => (
                        <Card key={tp.id} data-testid={`card-touchpoint-${tp.id}`}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <MessageSquare className="w-4 h-4 mt-1 text-muted-foreground" />
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm" data-testid={`text-touchpoint-subject-${tp.id}`}>{tp.subject}</span>
                                  <Badge variant="outline" className="text-xs" data-testid={`badge-touchpoint-type-${tp.id}`}>{tp.type}</Badge>
                                  <span className="text-xs text-muted-foreground" data-testid={`text-touchpoint-date-${tp.id}`}>
                                    {format(new Date(tp.createdAt), "MMM d, yyyy h:mm a")}
                                  </span>
                                </div>
                                {tp.notes && <p className="text-sm text-muted-foreground" data-testid={`text-touchpoint-notes-${tp.id}`}>{tp.notes}</p>}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Lead Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl">
          {selectedLead && (
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit(handleUpdateLead)}>
                <DialogHeader>
                  <DialogTitle data-testid="title-edit-lead">Edit Lead</DialogTitle>
                  <DialogDescription data-testid="description-edit-lead">Update lead information</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Business Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-edit-business-name" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-business-name" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="contactName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Contact Name *</FormLabel>
                          <FormControl>
                            <Input {...field} data-testid="input-edit-contact-name" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-contact-name" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input {...field} type="email" data-testid="input-edit-email" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-email" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone</FormLabel>
                          <FormControl>
                            <Input {...field} type="tel" data-testid="input-edit-phone" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-phone" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="priorityLevel"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Priority Level</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-priority">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="low" data-testid="option-edit-priority-low">Low</SelectItem>
                              <SelectItem value="medium" data-testid="option-edit-priority-medium">Medium</SelectItem>
                              <SelectItem value="high" data-testid="option-edit-priority-high">High</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-edit-priority" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="status"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Status</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-status">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="new" data-testid="option-edit-status-new">New</SelectItem>
                              <SelectItem value="contacted" data-testid="option-edit-status-contacted">Contacted</SelectItem>
                              <SelectItem value="qualified" data-testid="option-edit-status-qualified">Qualified</SelectItem>
                              <SelectItem value="proposal" data-testid="option-edit-status-proposal">Proposal</SelectItem>
                              <SelectItem value="negotiation" data-testid="option-edit-status-negotiation">Negotiation</SelectItem>
                              <SelectItem value="won" data-testid="option-edit-status-won">Won</SelectItem>
                              <SelectItem value="lost" data-testid="option-edit-status-lost">Lost</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-edit-status" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={editForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} data-testid="input-edit-notes" />
                        </FormControl>
                        <FormMessage data-testid="error-edit-notes" />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={updateLeadMutation.isPending} data-testid="button-submit-edit">
                    {updateLeadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Update Lead
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Touch Point Dialog */}
      <Dialog open={isTouchPointDialogOpen} onOpenChange={setIsTouchPointDialogOpen}>
        <DialogContent>
          {selectedLead && (
            <Form {...touchPointForm}>
              <form onSubmit={touchPointForm.handleSubmit(handleAddTouchPoint)}>
                <DialogHeader>
                  <DialogTitle data-testid="title-add-touchpoint">Add Touch Point</DialogTitle>
                  <DialogDescription data-testid="description-add-touchpoint">Record an interaction with {selectedLead.businessName}</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <FormField
                    control={touchPointForm.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-touchpoint-type">
                              <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="email" data-testid="option-touchpoint-email">Email</SelectItem>
                            <SelectItem value="phone_call" data-testid="option-touchpoint-phone">Phone Call</SelectItem>
                            <SelectItem value="meeting" data-testid="option-touchpoint-meeting">Meeting</SelectItem>
                            <SelectItem value="note" data-testid="option-touchpoint-note">Note</SelectItem>
                            <SelectItem value="other" data-testid="option-touchpoint-other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage data-testid="error-touchpoint-type" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={touchPointForm.control}
                    name="subject"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Subject *</FormLabel>
                        <FormControl>
                          <Input {...field} data-testid="input-touchpoint-subject" />
                        </FormControl>
                        <FormMessage data-testid="error-touchpoint-subject" />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={touchPointForm.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Notes</FormLabel>
                        <FormControl>
                          <Textarea {...field} rows={3} data-testid="input-touchpoint-notes" />
                        </FormControl>
                        <FormMessage data-testid="error-touchpoint-notes" />
                      </FormItem>
                    )}
                  />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createTouchPointMutation.isPending} data-testid="button-submit-touchpoint">
                    {createTouchPointMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                    Add Touch Point
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
