import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Search, Phone, Mail, Building2, User, Calendar, MessageSquare, Pencil, Trash2, X } from "lucide-react";
import { format } from "date-fns";

type Lead = {
  id: string;
  businessName: string;
  contactName: string;
  email?: string;
  phone?: string;
  priorityLevel: string;
  status: string;
  notes?: string;
  assignedToUserId?: string;
  createdAt: Date;
  updatedAt: Date;
};

type TouchPoint = {
  id: string;
  leadId: string;
  type: string;
  subject: string;
  notes?: string;
  createdByUserId: string;
  createdAt: Date;
};

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

  // Fetch search results
  const { data: searchResults = [], isLoading: isSearching } = useQuery<Lead[]>({
    queryKey: ["/api/crm/leads/search", searchQuery],
    queryFn: async () => {
      if (!searchQuery) return [];
      return await fetch(`/api/crm/leads/search?q=${encodeURIComponent(searchQuery)}`, {
        credentials: "include",
      }).then((res) => res.json());
    },
    enabled: searchQuery.length > 0,
  });

  // Fetch touch points for selected lead
  const { data: touchPoints = [] } = useQuery<TouchPoint[]>({
    queryKey: ["/api/crm/leads", selectedLead?.id, "touchpoints"],
    enabled: !!selectedLead,
  });

  // Create lead mutation
  const createLeadMutation = useMutation({
    mutationFn: async (data: any) => await apiRequest("POST", "/api/crm/leads", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Lead created successfully" });
      setIsCreateDialogOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Update lead mutation
  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      await apiRequest("PATCH", `/api/crm/leads/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Lead updated successfully" });
      setIsEditDialogOpen(false);
      setSelectedLead(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  // Create touch point mutation
  const createTouchPointMutation = useMutation({
    mutationFn: async ({ leadId, data }: { leadId: string; data: any }) =>
      await apiRequest("POST", `/api/crm/leads/${leadId}/touchpoints`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      toast({ title: "Success", description: "Touch point added successfully" });
      setIsTouchPointDialogOpen(false);
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

  const displayedLeads = searchQuery ? searchResults : leads.filter((lead) => {
    if (statusFilter !== "all" && lead.status !== statusFilter) return false;
    if (priorityFilter !== "all" && lead.priorityLevel !== priorityFilter) return false;
    return true;
  });

  const handleCreateLead = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      businessName: formData.get("businessName") as string,
      contactName: formData.get("contactName") as string,
      email: formData.get("email") as string || undefined,
      phone: formData.get("phone") as string || undefined,
      priorityLevel: formData.get("priorityLevel") as string,
      status: formData.get("status") as string,
      notes: formData.get("notes") as string || undefined,
    };
    createLeadMutation.mutate(data);
  };

  const handleUpdateLead = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const formData = new FormData(e.currentTarget);
    const data = {
      businessName: formData.get("businessName") as string,
      contactName: formData.get("contactName") as string,
      email: formData.get("email") as string || undefined,
      phone: formData.get("phone") as string || undefined,
      priorityLevel: formData.get("priorityLevel") as string,
      status: formData.get("status") as string,
      notes: formData.get("notes") as string || undefined,
    };
    updateLeadMutation.mutate({ id: selectedLead.id, data });
  };

  const handleAddTouchPoint = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedLead) return;
    const formData = new FormData(e.currentTarget);
    const data = {
      type: formData.get("type") as string,
      subject: formData.get("subject") as string,
      notes: formData.get("notes") as string || undefined,
    };
    createTouchPointMutation.mutate({ leadId: selectedLead.id, data });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">CRM - Lead Management</h2>
          <p className="text-muted-foreground">Track and manage potential customers</p>
        </div>
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-lead">
              <Plus className="w-4 h-4 mr-2" />
              New Lead
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <form onSubmit={handleCreateLead}>
              <DialogHeader>
                <DialogTitle>Create New Lead</DialogTitle>
                <DialogDescription>Add a new potential customer to your CRM</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="businessName">Business Name *</Label>
                    <Input id="businessName" name="businessName" required data-testid="input-business-name" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contactName">Contact Name *</Label>
                    <Input id="contactName" name="contactName" required data-testid="input-contact-name" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" data-testid="input-email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" type="tel" data-testid="input-phone" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="priorityLevel">Priority Level</Label>
                    <Select name="priorityLevel" defaultValue="medium">
                      <SelectTrigger data-testid="select-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="status">Status</Label>
                    <Select name="status" defaultValue="new">
                      <SelectTrigger data-testid="select-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacted">Contacted</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="negotiation">Negotiation</SelectItem>
                        <SelectItem value="won">Won</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes</Label>
                  <Textarea id="notes" name="notes" rows={3} data-testid="input-notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createLeadMutation.isPending} data-testid="button-submit-create">
                  {createLeadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Create Lead
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filter & Search</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Search</Label>
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
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger data-testid="select-status-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="qualified">Qualified</SelectItem>
                  <SelectItem value="proposal">Proposal</SelectItem>
                  <SelectItem value="negotiation">Negotiation</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                <SelectTrigger data-testid="select-priority-filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Priorities</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {(isLoading || isSearching) ? (
        <div className="flex items-center justify-center py-12 gap-2">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-muted-foreground">Loading leads...</span>
        </div>
      ) : displayedLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">No leads found</p>
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
                      <Badge className={priorityColors[lead.priorityLevel]}>
                        {lead.priorityLevel}
                      </Badge>
                      <Badge className={statusColors[lead.status]}>
                        {lead.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground flex-wrap">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4" />
                        <span>{lead.contactName}</span>
                      </div>
                      {lead.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4" />
                          <span>{lead.email}</span>
                        </div>
                      )}
                      {lead.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="w-4 h-4" />
                          <span>{lead.phone}</span>
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        <span>Created {format(new Date(lead.createdAt), "MMM d, yyyy")}</span>
                      </div>
                    </div>
                    {lead.notes && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{lead.notes}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead} onOpenChange={(open) => !open && setSelectedLead(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedLead && (
            <>
              <DialogHeader>
                <div className="flex items-start justify-between">
                  <div className="space-y-2">
                    <DialogTitle className="text-2xl">{selectedLead.businessName}</DialogTitle>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge className={priorityColors[selectedLead.priorityLevel]}>
                        {selectedLead.priorityLevel}
                      </Badge>
                      <Badge className={statusColors[selectedLead.status]}>
                        {selectedLead.status}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => setIsEditDialogOpen(true)}
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
                    <h4 className="text-sm font-semibold mb-2">Contact Information</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span>{selectedLead.contactName}</span>
                      </div>
                      {selectedLead.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          <a href={`mailto:${selectedLead.email}`} className="text-primary hover:underline">
                            {selectedLead.email}
                          </a>
                        </div>
                      )}
                      {selectedLead.phone && (
                        <div className="flex items-center gap-2">
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
                      <h4 className="text-sm font-semibold mb-2">Notes</h4>
                      <p className="text-sm text-muted-foreground">{selectedLead.notes}</p>
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-semibold">Touch Point History</h4>
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
                    <p className="text-sm text-muted-foreground text-center py-8">No touch points yet</p>
                  ) : (
                    <div className="space-y-3">
                      {touchPoints.map((tp) => (
                        <Card key={tp.id}>
                          <CardContent className="p-4">
                            <div className="flex items-start gap-3">
                              <MessageSquare className="w-4 h-4 mt-1 text-muted-foreground" />
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm">{tp.subject}</span>
                                  <Badge variant="outline" className="text-xs">{tp.type}</Badge>
                                  <span className="text-xs text-muted-foreground">
                                    {format(new Date(tp.createdAt), "MMM d, yyyy h:mm a")}
                                  </span>
                                </div>
                                {tp.notes && <p className="text-sm text-muted-foreground">{tp.notes}</p>}
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
            <form onSubmit={handleUpdateLead}>
              <DialogHeader>
                <DialogTitle>Edit Lead</DialogTitle>
                <DialogDescription>Update lead information</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-businessName">Business Name *</Label>
                    <Input
                      id="edit-businessName"
                      name="businessName"
                      defaultValue={selectedLead.businessName}
                      required
                      data-testid="input-edit-business-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-contactName">Contact Name *</Label>
                    <Input
                      id="edit-contactName"
                      name="contactName"
                      defaultValue={selectedLead.contactName}
                      required
                      data-testid="input-edit-contact-name"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-email">Email</Label>
                    <Input
                      id="edit-email"
                      name="email"
                      type="email"
                      defaultValue={selectedLead.email}
                      data-testid="input-edit-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-phone">Phone</Label>
                    <Input
                      id="edit-phone"
                      name="phone"
                      type="tel"
                      defaultValue={selectedLead.phone}
                      data-testid="input-edit-phone"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-priorityLevel">Priority Level</Label>
                    <Select name="priorityLevel" defaultValue={selectedLead.priorityLevel}>
                      <SelectTrigger data-testid="select-edit-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="low">Low</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="high">High</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-status">Status</Label>
                    <Select name="status" defaultValue={selectedLead.status}>
                      <SelectTrigger data-testid="select-edit-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="new">New</SelectItem>
                        <SelectItem value="contacted">Contacted</SelectItem>
                        <SelectItem value="qualified">Qualified</SelectItem>
                        <SelectItem value="proposal">Proposal</SelectItem>
                        <SelectItem value="negotiation">Negotiation</SelectItem>
                        <SelectItem value="won">Won</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-notes">Notes</Label>
                  <Textarea
                    id="edit-notes"
                    name="notes"
                    defaultValue={selectedLead.notes}
                    rows={3}
                    data-testid="input-edit-notes"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={updateLeadMutation.isPending} data-testid="button-submit-edit">
                  {updateLeadMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Update Lead
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Touch Point Dialog */}
      <Dialog open={isTouchPointDialogOpen} onOpenChange={setIsTouchPointDialogOpen}>
        <DialogContent>
          {selectedLead && (
            <form onSubmit={handleAddTouchPoint}>
              <DialogHeader>
                <DialogTitle>Add Touch Point</DialogTitle>
                <DialogDescription>Record an interaction with {selectedLead.businessName}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="type">Type *</Label>
                  <Select name="type" required>
                    <SelectTrigger data-testid="select-touchpoint-type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="phone_call">Phone Call</SelectItem>
                      <SelectItem value="meeting">Meeting</SelectItem>
                      <SelectItem value="note">Note</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject *</Label>
                  <Input id="subject" name="subject" required data-testid="input-touchpoint-subject" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tp-notes">Notes</Label>
                  <Textarea id="tp-notes" name="notes" rows={3} data-testid="input-touchpoint-notes" />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={createTouchPointMutation.isPending} data-testid="button-submit-touchpoint">
                  {createTouchPointMutation.isPending && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                  Add Touch Point
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
