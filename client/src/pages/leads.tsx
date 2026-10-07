import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Pencil, Trash2, ArrowUp, ArrowDown, ArrowUpDown, CalendarPlus, CalendarCheck, Check } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { LinkifiedText, firstWebAddress } from "@/components/linkified-text";
import { weekMondayOf, visitWeekLabel } from "@shared/lead-visits";
import { StaffLayout } from "@/components/staff/staff-layout";
import {
  insertLeadSchema,
  insertLeadTouchPointSchema,
  LEAD_TYPES,
  LEAD_TYPE_LABELS,
  type Lead,
  type LeadTouchPoint,
  type LeadType,
} from "@shared/schema";
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

// The leads spreadsheet (owner, 2026-09-29: "more of a spreadsheet style sortable
// data table. Sort by fields should be name and zip code. Also add a filter for
// type"). Name is the business name.
type LeadSortKey = "name" | "zip";
const LEAD_SORT_NAMES: Record<LeadSortKey, string> = { name: "business name", zip: "zip code" };
// The Type filter: every lead, one type, or the leads nobody has typed yet.
type LeadTypeFilter = "all" | LeadType | "none";

const leadTypeLabel = (type: string | null) => (type ? LEAD_TYPE_LABELS[type as LeadType] ?? type : null);

// The edit form's values for a lead.
const leadFormValues = (lead: Lead): z.infer<typeof insertLeadSchema> => ({
  businessName: lead.businessName,
  contactName: lead.contactName || "",
  email: lead.email || "",
  phone: lead.phone || "",
  priorityLevel: lead.priorityLevel,
  status: lead.status,
  notes: lead.notes || "",
  businessType: (lead.businessType as LeadType | null) ?? null,
  zipCode: lead.zipCode ?? "",
  address: lead.address ?? "",
  city: lead.city ?? "",
});

// Spreadsheet cells: a gridline on every cell (border-separate keeps them on the
// sticky header and the frozen columns), one line each, and an opaque ground so
// the frozen Name and action columns cover the cells that scroll under them.
const TH = "sticky top-0 z-20 h-8 px-2 text-left align-middle text-xs font-medium text-muted-foreground whitespace-nowrap bg-muted border-b border-r";
const TD = "h-9 px-2 align-middle whitespace-nowrap bg-card group-hover:bg-muted border-b border-r";
const FROZEN_RIGHT_EDGE = "border-r-0 shadow-[-1px_0_0_hsl(var(--border))]";

// A page of its own since 2026-10-07; it used to be the CRM tab of the legacy
// tabbed Staff Portal (owner: "This page should just be its own page").
export default function LeadsPage() {
  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12">
        <LeadsSheet />
      </div>
    </StaffLayout>
  );
}

function LeadsSheet() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<LeadTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  // Visit this week (owner, 2026-10-05): a lead tagged for the current week is
  // offered as a stop on the Routes page. The week is named by its Monday.
  const [visitFilter, setVisitFilter] = useState(false);
  const thisWeek = weekMondayOf(format(new Date(), "yyyy-MM-dd"));
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isTouchPointDialogOpen, setIsTouchPointDialogOpen] = useState(false);

  // Fetch all leads
  const { data: allLeads = [], isLoading } = useQuery<Lead[]>({
    queryKey: ["/api/crm/leads"],
    enabled: searchQuery === "",
  });

  // The default fetcher joins the query key into a URL path, so params must be sent
  // as a real query string here (an object key would produce "/[object Object]").
  const { data: searchResults = [], isLoading: isSearching } = useQuery<Lead[]>({
    queryKey: ["/api/crm/leads/search", searchQuery],
    queryFn: () =>
      apiRequest("GET", `/api/crm/leads/search?q=${encodeURIComponent(searchQuery)}`),
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
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads", variables.leadId, "touchpoints"] });
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
      // Search results are their own query; a deleted lead leaves them too.
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads/search"] });
      toast({ title: "Lead deleted" });
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
      businessType: null,
      zipCode: "",
      address: "",
      city: "",
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
      businessType: null,
      zipCode: "",
      address: "",
      city: "",
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

  // The filters narrow search results too.
  const displayedLeads = (searchQuery ? searchResults : allLeads).filter((lead) => {
    if (visitFilter && lead.visitWeek !== thisWeek) return false;
    if (typeFilter !== "all" && (lead.businessType || "none") !== typeFilter) return false;
    if (statusFilter !== "all" && lead.status !== statusFilter) return false;
    if (priorityFilter !== "all" && lead.priorityLevel !== priorityFilter) return false;
    return true;
  });

  // A–Z by name until a header says otherwise; clicking the sorted column flips
  // it. Leads without a zip go last either way, and ties go A–Z by name.
  const [sort, setSort] = useState<{ key: LeadSortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const sortBy = (key: LeadSortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  const sortedLeads = [...displayedLeads].sort((a, b) => {
    const byName = a.businessName.localeCompare(b.businessName, undefined, { sensitivity: "base", numeric: true });
    const sign = sort.dir === "asc" ? 1 : -1;
    if (sort.key === "name") return sign * byName;
    if (!a.zipCode || !b.zipCode) return (a.zipCode ? -1 : 0) + (b.zipCode ? 1 : 0) || byName;
    return sign * a.zipCode.localeCompare(b.zipCode) || byName;
  });
  const leadCount = sortedLeads.length === allLeads.length
    ? `${allLeads.length} ${allLeads.length === 1 ? "lead" : "leads"}`
    : `${sortedLeads.length} of ${allLeads.length} leads`;
  const sortableHead = (key: LeadSortKey, label: string, className?: string) => {
    const active = sort.key === key;
    return (
      <th className={cn(TH, className)} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}>
        <button
          type="button"
          className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}
          onClick={() => sortBy(key)}
          title={`Sort by ${LEAD_SORT_NAMES[key]}`}
          data-testid={`button-sort-leads-${key}`}
        >
          {label}
          {!active
            ? <ArrowUpDown className="w-3 h-3 opacity-40" />
            : sort.dir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
        </button>
      </th>
    );
  };
  const dash = <span className="text-muted-foreground">—</span>;

  // Tag a lead for a visit this week, or take the tag off.
  const visitMutation = useMutation({
    mutationFn: async ({ id, week }: { id: string; week: string | null }) =>
      await apiRequest("PUT", `/api/crm/leads/${id}/visit`, { week }),
    onSuccess: (lead: Lead, { week }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads/search"] });
      setSelectedLead((current) => (current && current.id === lead.id ? lead : current));
      toast({ title: week ? `Tagged for a visit the week of ${visitWeekLabel(week)}` : "Visit tag removed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  const toggleVisit = (lead: Lead) =>
    visitMutation.mutate({ id: lead.id, week: lead.visitWeek === thisWeek ? null : thisWeek });
  // A visit marked from the sheet — a drop-in on the owner's own time, no route
  // (owner, 2026-10-07) — or undone. Driver Mode records the route visits.
  const visitedMutation = useMutation({
    mutationFn: async ({ id, visited }: { id: string; visited: boolean }) =>
      visited
        ? await apiRequest("POST", `/api/crm/leads/${id}/visited`, { source: "sheet" })
        : await apiRequest("DELETE", `/api/crm/leads/${id}/visited`),
    onSuccess: (lead: Lead, { visited }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/leads/search"] });
      setSelectedLead((current) => (current && current.id === lead.id ? lead : current));
      toast({ title: visited ? "Marked visited" : "Visit undone" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
  const undoVisit = (lead: Lead) => {
    if (confirm(`Undo the visit to "${lead.businessName}"? The visit comes off its history.`)) {
      visitedMutation.mutate({ id: lead.id, visited: false });
    }
  };
  // How a lead's visit reads: the last visit (until a new tag starts the next
  // one over), this week, or a week still to come. A past week is no tag any more.
  const visitState = (lead: Lead): { label: string; done: boolean } | null => {
    if (lead.visitedAt) return { label: `Visited ${format(new Date(lead.visitedAt), "MMM d")}`, done: true };
    if (!lead.visitWeek || lead.visitWeek < thisWeek) return null;
    return { label: lead.visitWeek === thisWeek ? "This week" : `Week of ${visitWeekLabel(lead.visitWeek)}`, done: false };
  };

  // One click and a confirmation: the lead's touch-point history goes with it.
  const deleteLead = (lead: Lead) => {
    if (confirm(`Delete "${lead.businessName}"? Its touch-point history is deleted too.`)) {
      deleteLeadMutation.mutate(lead.id);
    }
  };

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
      editForm.reset(leadFormValues(selectedLead));
    }
  }, [selectedLead, isEditDialogOpen]);

  const openEditDialog = (lead: Lead) => {
    setSelectedLead(lead);
    editForm.reset(leadFormValues(lead));
    setIsEditDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ fontFamily: 'var(--font-heading)' }} data-testid="heading-crm">Leads</h1>
          <p className="text-muted-foreground" data-testid="text-crm-description">Prospects to visit and sign as wholesale accounts</p>
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
                          <FormLabel>Contact Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Add when you have one" data-testid="input-contact-name" />
                          </FormControl>
                          <FormMessage data-testid="error-contact-name" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="businessType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type</FormLabel>
                          <Select onValueChange={(value) => field.onChange(value === "none" ? null : value)} value={field.value ?? "none"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {LEAD_TYPES.map((type) => (
                                <SelectItem key={type} value={type} data-testid={`option-type-${type}`}>{LEAD_TYPE_LABELS[type]}</SelectItem>
                              ))}
                              <SelectItem value="none" data-testid="option-type-none">No type</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-type" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="zipCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Zip Code</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} inputMode="numeric" maxLength={10} placeholder="98107" data-testid="input-zip" />
                          </FormControl>
                          <FormMessage data-testid="error-zip" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={createForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="1417 NW 54th St" data-testid="input-address" />
                          </FormControl>
                          <FormMessage data-testid="error-address" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={createForm.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Seattle" data-testid="input-city" />
                          </FormControl>
                          <FormMessage data-testid="error-city" />
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

      {/* Filters: they narrow the sheet, searches included. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="toolbar-leads">
        <Input
          type="search"
          placeholder="Search name, phone, email or zip"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-9 w-full sm:w-72"
          aria-label="Search leads"
          data-testid="input-search"
        />
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as LeadTypeFilter)}>
          <SelectTrigger className="h-9 w-[9.5rem]" aria-label="Type" data-testid="select-type-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="option-filter-type-all">All types</SelectItem>
            {LEAD_TYPES.map((type) => (
              <SelectItem key={type} value={type} data-testid={`option-filter-type-${type}`}>{LEAD_TYPE_LABELS[type]}</SelectItem>
            ))}
            <SelectItem value="none" data-testid="option-filter-type-none">No type</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[9.5rem]" aria-label="Status" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="option-filter-status-all">All statuses</SelectItem>
            <SelectItem value="new" data-testid="option-filter-status-new">New</SelectItem>
            <SelectItem value="contacted" data-testid="option-filter-status-contacted">Contacted</SelectItem>
            <SelectItem value="qualified" data-testid="option-filter-status-qualified">Qualified</SelectItem>
            <SelectItem value="proposal" data-testid="option-filter-status-proposal">Proposal</SelectItem>
            <SelectItem value="negotiation" data-testid="option-filter-status-negotiation">Negotiation</SelectItem>
            <SelectItem value="won" data-testid="option-filter-status-won">Won</SelectItem>
            <SelectItem value="lost" data-testid="option-filter-status-lost">Lost</SelectItem>
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="h-9 w-[9.5rem]" aria-label="Priority" data-testid="select-priority-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" data-testid="option-filter-priority-all">All priorities</SelectItem>
            <SelectItem value="low" data-testid="option-filter-priority-low">Low</SelectItem>
            <SelectItem value="medium" data-testid="option-filter-priority-medium">Medium</SelectItem>
            <SelectItem value="high" data-testid="option-filter-priority-high">High</SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant={visitFilter ? "secondary" : "outline"}
          size="sm"
          className="h-9"
          aria-pressed={visitFilter}
          title={`Leads tagged for the week of ${visitWeekLabel(thisWeek)}`}
          onClick={() => setVisitFilter((on) => !on)}
          data-testid="button-filter-visits"
        >
          <CalendarCheck className="w-4 h-4 mr-1.5" />
          Visits this week
        </Button>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums" data-testid="text-lead-count">{leadCount}</span>
      </div>

      {(isLoading || isSearching) ? (
        <div className="flex items-center justify-center py-12 gap-2" data-testid="loading-leads">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span className="text-muted-foreground">Loading leads...</span>
        </div>
      ) : displayedLeads.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground" data-testid="text-no-leads">No leads found</p>
          </CardContent>
        </Card>
      ) : (
        // A spreadsheet: sticky header row, Name frozen on the left and (wider
        // than a phone) the edit/delete buttons on the right while the columns
        // between scroll.
        <div className="max-h-[70vh] overflow-auto rounded-md border bg-card" data-testid="table-leads">
          <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {sortableHead("name", "Name", "left-0 z-30")}
                <th className={TH}>Visit</th>
                <th className={TH}>Type</th>
                {sortableHead("zip", "Zip")}
                <th className={TH}>Address</th>
                <th className={TH}>Phone</th>
                <th className={TH}>Website</th>
                <th className={TH}>Status</th>
                <th className={TH}>Priority</th>
                <th className={TH}>Contact</th>
                <th className={TH}>Email</th>
                <th className={TH}>Notes</th>
                <th className={TH}>Added</th>
                <th className={cn(TH, "z-30 sm:right-0", FROZEN_RIGHT_EDGE)}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child>td]:border-b-0">
              {sortedLeads.map((lead) => {
                const site = firstWebAddress(lead.notes);
                return (
                  <tr
                    key={lead.id}
                    className="group cursor-pointer"
                    onClick={() => setSelectedLead(lead)}
                    data-testid={`row-lead-${lead.id}`}
                  >
                    <td className={cn(TD, "sticky left-0 z-10 font-medium")} data-testid={`text-business-name-${lead.id}`}>
                      <div className="max-w-[9rem] truncate sm:max-w-[16rem]" title={lead.businessName}>
                        <LinkifiedText text={lead.businessName} />
                      </div>
                    </td>
                    <td className={cn(TD, "px-1")} data-testid={`cell-visit-${lead.id}`}>
                      {(() => {
                        const visit = visitState(lead);
                        const tagged = lead.visitWeek === thisWeek;
                        const busy =
                          (visitMutation.isPending && visitMutation.variables?.id === lead.id) ||
                          (visitedMutation.isPending && visitedMutation.variables?.id === lead.id);
                        if (visit?.done) {
                          return (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 font-normal text-green-700 dark:text-green-400"
                              title="Undo this visit"
                              disabled={busy}
                              onClick={(e) => { e.stopPropagation(); undoVisit(lead); }}
                              data-testid={`button-visit-${lead.id}`}
                            >
                              <CalendarCheck className="w-3.5 h-3.5 mr-1" />
                              {visit.label}
                            </Button>
                          );
                        }
                        return (
                          <div className="flex items-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className={cn("h-7 px-2 font-normal", tagged ? "text-primary" : "text-muted-foreground")}
                              title={tagged ? "Take the visit tag off" : `Visit this week (${visitWeekLabel(thisWeek)})`}
                              disabled={busy}
                              onClick={(e) => { e.stopPropagation(); toggleVisit(lead); }}
                              data-testid={`button-visit-${lead.id}`}
                            >
                              <CalendarPlus className="w-3.5 h-3.5 mr-1" />
                              {visit ? visit.label : "Visit this week"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-green-700 dark:hover:text-green-400"
                              title="Mark visited — dropped in, no route"
                              disabled={busy}
                              onClick={(e) => { e.stopPropagation(); visitedMutation.mutate({ id: lead.id, visited: true }); }}
                              data-testid={`button-mark-visited-${lead.id}`}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        );
                      })()}
                    </td>
                    <td className={TD} data-testid={`text-type-${lead.id}`}>{leadTypeLabel(lead.businessType) ?? dash}</td>
                    <td className={cn(TD, "tabular-nums")} data-testid={`text-zip-${lead.id}`}>{lead.zipCode ?? dash}</td>
                    <td className={TD} data-testid={`text-address-${lead.id}`}>
                      {lead.address ? (
                        <div className="max-w-[16rem] truncate" title={[lead.address, lead.city].filter(Boolean).join(", ")}>
                          {[lead.address, lead.city].filter(Boolean).join(", ")}
                        </div>
                      ) : dash}
                    </td>
                    <td className={cn(TD, "tabular-nums")} data-testid={`text-phone-${lead.id}`}>
                      {lead.phone ? (
                        <a href={`tel:${lead.phone}`} className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                          {lead.phone}
                        </a>
                      ) : dash}
                    </td>
                    <td className={TD} data-testid={`text-website-${lead.id}`}>
                      {site ? (
                        <a
                          href={site.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block max-w-[12rem] truncate text-primary hover:underline"
                          title={site.href}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {site.host}
                        </a>
                      ) : dash}
                    </td>
                    <td className={TD}>
                      <Badge className={statusColors[lead.status]} data-testid={`badge-status-${lead.id}`}>{lead.status}</Badge>
                    </td>
                    <td className={TD}>
                      <Badge className={priorityColors[lead.priorityLevel]} data-testid={`badge-priority-${lead.id}`}>{lead.priorityLevel}</Badge>
                    </td>
                    <td className={TD} data-testid={`text-contact-${lead.id}`}>
                      {lead.contactName ? <div className="max-w-[10rem] truncate" title={lead.contactName}>{lead.contactName}</div> : dash}
                    </td>
                    <td className={TD} data-testid={`text-email-${lead.id}`}>
                      {lead.email ? (
                        <a
                          href={`mailto:${lead.email}`}
                          className="block max-w-[14rem] truncate text-primary hover:underline"
                          title={lead.email}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {lead.email}
                        </a>
                      ) : dash}
                    </td>
                    <td className={cn(TD, "text-muted-foreground")} data-testid={`text-notes-preview-${lead.id}`}>
                      {lead.notes ? (
                        <div className="max-w-[24rem] truncate" title={lead.notes}>
                          <LinkifiedText text={lead.notes} />
                        </div>
                      ) : "—"}
                    </td>
                    <td className={cn(TD, "text-muted-foreground tabular-nums")} data-testid={`text-created-${lead.id}`}>
                      {format(new Date(lead.createdAt), "MMM d, yyyy")}
                    </td>
                    <td className={cn(TD, "px-1 sm:sticky sm:right-0 sm:z-10", FROZEN_RIGHT_EDGE)}>
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Edit lead"
                          aria-label={`Edit ${lead.businessName}`}
                          onClick={(e) => { e.stopPropagation(); openEditDialog(lead); }}
                          data-testid={`button-edit-lead-${lead.id}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          title="Delete lead"
                          aria-label={`Delete ${lead.businessName}`}
                          disabled={deleteLeadMutation.isPending && deleteLeadMutation.variables === lead.id}
                          onClick={(e) => { e.stopPropagation(); deleteLead(lead); }}
                          data-testid={`button-delete-lead-${lead.id}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Lead Detail Dialog */}
      <Dialog open={!!selectedLead && !isEditDialogOpen} onOpenChange={(open) => !open && setSelectedLead(null)}>
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
                      {selectedLead.businessType && (
                        <Badge variant="outline" data-testid="badge-detail-type">{leadTypeLabel(selectedLead.businessType)}</Badge>
                      )}
                      {selectedLead.zipCode && (
                        <span className="text-sm text-muted-foreground tabular-nums" data-testid="text-detail-zip">Zip {selectedLead.zipCode}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {visitState(selectedLead)?.done ? (
                      <Button
                        variant="secondary"
                        disabled={visitedMutation.isPending}
                        onClick={() => undoVisit(selectedLead)}
                        title="Undo this visit"
                        data-testid="button-detail-visit"
                      >
                        <CalendarCheck className="w-4 h-4 mr-1.5" />
                        {visitState(selectedLead)?.label}
                      </Button>
                    ) : (
                      <>
                        <Button
                          variant={selectedLead.visitWeek === thisWeek ? "secondary" : "outline"}
                          disabled={visitMutation.isPending}
                          onClick={() => toggleVisit(selectedLead)}
                          data-testid="button-detail-visit"
                        >
                          <CalendarPlus className="w-4 h-4 mr-1.5" />
                          {visitState(selectedLead)?.label ?? "Visit this week"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={visitedMutation.isPending}
                          onClick={() => visitedMutation.mutate({ id: selectedLead.id, visited: true })}
                          title="Dropped in on your own — no route needed"
                          data-testid="button-detail-mark-visited"
                        >
                          <Check className="w-4 h-4 mr-1.5" />
                          Mark visited
                        </Button>
                      </>
                    )}
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
                        {selectedLead.contactName
                          ? <span>{selectedLead.contactName}</span>
                          : <span className="text-muted-foreground">No contact yet</span>}
                      </div>
                      {selectedLead.email && (
                        <div className="flex items-center gap-2" data-testid="text-detail-email">
                          <a href={`mailto:${selectedLead.email}`} className="text-primary hover:underline">
                            {selectedLead.email}
                          </a>
                        </div>
                      )}
                      {selectedLead.phone && (
                        <div className="flex items-center gap-2" data-testid="text-detail-phone">
                          <a href={`tel:${selectedLead.phone}`} className="text-primary hover:underline">
                            {selectedLead.phone}
                          </a>
                        </div>
                      )}
                      {selectedLead.address && (
                        <div data-testid="text-detail-address">
                          {[selectedLead.address, selectedLead.city, selectedLead.state, selectedLead.zipCode].filter(Boolean).join(", ")}
                          {!selectedLead.latitude && <span className="text-muted-foreground"> — not on the map yet (Geocode All on the Routes page)</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedLead.notes && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2" data-testid="heading-notes">Notes</h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-detail-notes">
                        <LinkifiedText text={selectedLead.notes} />
                      </p>
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
                              <div className="flex-1 space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-semibold text-sm" data-testid={`text-touchpoint-subject-${tp.id}`}>{tp.subject}</span>
                                  <Badge variant="outline" className="text-xs" data-testid={`badge-touchpoint-type-${tp.id}`}>{tp.type}</Badge>
                                  <span className="text-xs text-muted-foreground" data-testid={`text-touchpoint-date-${tp.id}`}>
                                    {format(new Date(tp.createdAt), "MMM d, yyyy h:mm a")}
                                  </span>
                                </div>
                                {tp.notes && (
                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid={`text-touchpoint-notes-${tp.id}`}>
                                    <LinkifiedText text={tp.notes} />
                                  </p>
                                )}
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
                          <FormLabel>Contact Name</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Add when you have one" data-testid="input-edit-contact-name" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-contact-name" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="businessType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Type</FormLabel>
                          <Select onValueChange={(value) => field.onChange(value === "none" ? null : value)} value={field.value ?? "none"}>
                            <FormControl>
                              <SelectTrigger data-testid="select-edit-type">
                                <SelectValue />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {LEAD_TYPES.map((type) => (
                                <SelectItem key={type} value={type} data-testid={`option-edit-type-${type}`}>{LEAD_TYPE_LABELS[type]}</SelectItem>
                              ))}
                              <SelectItem value="none" data-testid="option-edit-type-none">No type</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage data-testid="error-edit-type" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="zipCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Zip Code</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} inputMode="numeric" maxLength={10} placeholder="98107" data-testid="input-edit-zip" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-zip" />
                        </FormItem>
                      )}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={editForm.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Street</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="1417 NW 54th St" data-testid="input-edit-address" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-address" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={editForm.control}
                      name="city"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>City</FormLabel>
                          <FormControl>
                            <Input {...field} value={field.value ?? ""} placeholder="Seattle" data-testid="input-edit-city" />
                          </FormControl>
                          <FormMessage data-testid="error-edit-city" />
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
