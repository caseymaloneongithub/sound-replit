import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Eye } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { User } from "@shared/schema";

type UserWithImpersonation = User & {
  impersonation?: {
    isImpersonating: boolean;
    originalUser: { id: string; username: string };
  };
};

const PORTAL_ROLES = ['staff', 'admin', 'super_admin'];
const ROLE_RANK: Record<string, number> = { super_admin: 0, admin: 1, staff: 2, wholesale_customer: 3, user: 4 };
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  staff: 'Staff',
  wholesale_customer: 'Wholesale Customer',
  user: 'User',
};

// Super-admin only (the route and every endpoint here are gated that way): who can sign in
// to the staff portal and at what level, plus the Stripe customer backfill. Extracted from
// the legacy tabbed Staff Portal, where it was the "User Management" tab.
export default function UserManagement() {
  const { toast } = useToast();

  const { data: user } = useQuery<UserWithImpersonation>({
    queryKey: ['/api/user'],
    retry: false,
  });

  // "Who has portal access" is the question this page answers, so it defaults to portal
  // roles only; All + search exist to find a customer account and promote it.
  const [userFilter, setUserFilter] = useState<'portal' | 'all'>('portal');
  const [userSearch, setUserSearch] = useState('');
  const [addStaffOpen, setAddStaffOpen] = useState(false);
  const [staffForm, setStaffForm] = useState({ firstName: '', lastName: '', email: '', role: 'staff' });
  const [backfillResults, setBackfillResults] = useState<any>(null);

  const { data: allUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['/api/staff/users'],
  });

  const visibleUsers = allUsers
    .filter(u => userFilter === 'all' || PORTAL_ROLES.includes(u.role))
    .filter(u => {
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      return [u.firstName, u.lastName, u.email, u.username]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q));
    })
    .sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || String(a.email ?? '').localeCompare(String(b.email ?? '')));

  const addStaffMutation = useMutation({
    mutationFn: async () => apiRequest('POST', '/api/staff/users', staffForm),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff/users'] });
      setAddStaffOpen(false);
      setStaffForm({ firstName: '', lastName: '', email: '', role: 'staff' });
      toast({
        title: 'Staff member added',
        description: data.invite === 'sent'
          ? 'An invite with a set-password link is on its way.'
          : 'Invite email suppressed outside production — send them a password reset from the login page instead.',
      });
    },
    onError: (e: any) => toast({ title: "Couldn't add staff member", description: e.message, variant: 'destructive' }),
  });

  const updateUserRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest('PATCH', `/api/staff/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/staff/users'] });
      toast({ title: "User role updated", description: "User role has been updated successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update user role", variant: "destructive" });
    },
  });

  const backfillStripeCustomersMutation = useMutation({
    mutationFn: async ({ dryRun }: { dryRun: boolean }) => {
      return await apiRequest('POST', '/api/admin/backfill-stripe-customers', { dryRun });
    },
    onSuccess: (data) => {
      setBackfillResults(data);
      if (!data.dryRun) {
        queryClient.invalidateQueries({ queryKey: ['/api/staff/users'] });
      }
      toast({ title: data.dryRun ? "Dry Run Complete" : "Backfill Complete", description: data.message });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to backfill Stripe customers", variant: "destructive" });
    },
  });

  const impersonateMutation = useMutation({
    mutationFn: async (userId: string) => {
      const response = await fetch('/api/impersonate/start', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to impersonate user');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user'] });
      window.location.href = '/shop';
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to impersonate user", variant: "destructive" });
    },
  });

  const portalCount = allUsers.filter(x => PORTAL_ROLES.includes(x.role)).length;

  return (
    <StaffLayout>
      <div className="max-w-7xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: 'var(--font-heading)' }}>
            User Management
          </h1>
          <p className="text-muted-foreground">
            Who can sign in to the staff portal, and at what level. Switch to All users to find a customer account and promote it.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-2">
            <Button
              variant={userFilter === 'portal' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setUserFilter('portal')}
              data-testid="button-filter-portal"
            >
              Portal access ({portalCount})
            </Button>
            <Button
              variant={userFilter === 'all' ? 'secondary' : 'outline'}
              size="sm"
              onClick={() => setUserFilter('all')}
              data-testid="button-filter-all"
            >
              All users ({allUsers.length})
            </Button>
          </div>
          <Input
            value={userSearch}
            onChange={(e) => setUserSearch(e.target.value)}
            placeholder="Search name, email, username…"
            className="max-w-xs h-9"
            data-testid="input-user-search"
          />
          <Dialog open={addStaffOpen} onOpenChange={setAddStaffOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="ml-auto" data-testid="button-add-staff">Add staff member</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add staff member</DialogTitle>
                <DialogDescription>
                  Creates the account with portal access and emails a set-password link (good for 7 days).
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="staff-first">First name</Label>
                    <Input id="staff-first" className="mt-1.5" value={staffForm.firstName}
                      onChange={(e) => setStaffForm((f) => ({ ...f, firstName: e.target.value }))}
                      data-testid="input-staff-first" />
                  </div>
                  <div>
                    <Label htmlFor="staff-last">Last name</Label>
                    <Input id="staff-last" className="mt-1.5" value={staffForm.lastName}
                      onChange={(e) => setStaffForm((f) => ({ ...f, lastName: e.target.value }))}
                      data-testid="input-staff-last" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="staff-email">Email</Label>
                  <Input id="staff-email" type="email" className="mt-1.5" value={staffForm.email}
                    onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                    data-testid="input-staff-email" />
                </div>
                <div>
                  <Label>Role</Label>
                  <Select value={staffForm.role} onValueChange={(v) => setStaffForm((f) => ({ ...f, role: v }))}>
                    <SelectTrigger className="mt-1.5" data-testid="select-staff-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="staff">Staff — day-to-day pages only</SelectItem>
                      <SelectItem value="admin">Admin — full portal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={() => addStaffMutation.mutate()}
                  disabled={addStaffMutation.isPending || !staffForm.firstName.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(staffForm.email)}
                  data-testid="button-submit-staff"
                >
                  {addStaffMutation.isPending ? 'Adding…' : 'Add & send invite'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {usersLoading ? (
          <div className="flex items-center justify-center py-12 gap-2">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-muted-foreground">Loading users...</span>
          </div>
        ) : allUsers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No users found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {visibleUsers.map((u) => (
              <Card key={u.id} data-testid={`card-user-${u.id}`}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="text-lg">
                      {u.firstName} {u.lastName}
                    </span>
                    <Badge
                      variant={u.role === 'super_admin' ? 'default' : u.role === 'admin' ? 'secondary' : 'outline'}
                      data-testid={`badge-role-${u.id}`}
                    >
                      {ROLE_LABELS[u.role] ?? 'User'}
                    </Badge>
                  </CardTitle>
                  <CardDescription data-testid={`text-email-${u.id}`}>
                    {u.email}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <Label htmlFor={`role-${u.id}`}>Role</Label>
                    <Select
                      value={u.role}
                      onValueChange={(role) => {
                        if (u.id !== user?.id) {
                          updateUserRoleMutation.mutate({ userId: u.id, role });
                        }
                      }}
                      disabled={u.id === user?.id || updateUserRoleMutation.isPending}
                    >
                      <SelectTrigger id={`role-${u.id}`} data-testid={`select-role-${u.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user" data-testid={`option-user-${u.id}`}>User — no portal access</SelectItem>
                        <SelectItem value="wholesale_customer" data-testid={`option-wholesale-${u.id}`}>Wholesale Customer</SelectItem>
                        <SelectItem value="staff" data-testid={`option-staff-${u.id}`}>Staff — portal, day-to-day ops</SelectItem>
                        <SelectItem value="admin" data-testid={`option-admin-${u.id}`}>Admin — portal + admin areas</SelectItem>
                        <SelectItem value="super_admin" data-testid={`option-super-admin-${u.id}`}>Super Admin — everything</SelectItem>
                      </SelectContent>
                    </Select>
                    {u.id === user?.id && (
                      <p className="text-xs text-muted-foreground">
                        You cannot change your own role
                      </p>
                    )}
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => impersonateMutation.mutate(u.id)}
                    disabled={
                      u.id === user?.id ||
                      user?.impersonation?.isImpersonating ||
                      impersonateMutation.isPending
                    }
                    data-testid={`button-impersonate-${u.id}`}
                    className="w-full"
                  >
                    <Eye className="w-4 h-4 mr-2" />
                    {impersonateMutation.isPending ? "Impersonating..." : "Impersonate"}
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Stripe Customer Sync</CardTitle>
            <CardDescription>
              Create Stripe customer records for retail customers who don't have them yet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={() => backfillStripeCustomersMutation.mutate({ dryRun: true })}
                  variant="outline"
                  disabled={backfillStripeCustomersMutation.isPending}
                  data-testid="button-stripe-dry-run"
                >
                  {backfillStripeCustomersMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    'Preview (Dry Run)'
                  )}
                </Button>
                <Button
                  onClick={() => backfillStripeCustomersMutation.mutate({ dryRun: false })}
                  disabled={backfillStripeCustomersMutation.isPending}
                  data-testid="button-stripe-backfill"
                >
                  {backfillStripeCustomersMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Processing...
                    </>
                  ) : (
                    'Sync to Stripe'
                  )}
                </Button>
              </div>

              {backfillResults && (
                <div className="p-3 border rounded-md bg-muted/50">
                  <p className="font-semibold mb-2">
                    {backfillResults.dryRun ? 'Dry Run Results:' : 'Backfill Results:'}
                  </p>
                  <div className="text-sm space-y-1">
                    <p>Total users: {backfillResults.total}</p>
                    {!backfillResults.dryRun && (
                      <>
                        <p className="text-green-600">Successful: {backfillResults.successful}</p>
                        <p className="text-red-600">Failed: {backfillResults.failed}</p>
                      </>
                    )}
                    {backfillResults.errors && backfillResults.errors.length > 0 && (
                      <div className="mt-2">
                        <p className="font-semibold text-red-600">Errors:</p>
                        {backfillResults.errors.map((err: any, idx: number) => (
                          <p key={idx} className="text-xs text-red-600">
                            {err.username}: {err.error}
                          </p>
                        ))}
                      </div>
                    )}
                    {backfillResults.users && backfillResults.users.length > 0 && (
                      <div className="mt-2">
                        <p className="font-semibold">Users to sync:</p>
                        {backfillResults.users.map((u: any, idx: number) => (
                          <p key={idx} className="text-xs">
                            {u.username} ({u.email}) - {u.role}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
