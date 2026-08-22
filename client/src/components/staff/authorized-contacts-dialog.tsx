import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { RequestActions } from "./contact-requests-panel";

type ContactRow = {
  email: string;
  isPrimary: boolean;
  hasLogin: boolean;
  lastOrderedAt: string | null;
  pendingRequestId: string | null;
  addedBy: "staff" | "domain-match" | "approved" | null;
};

/**
 * Authorized contacts for one store: who can sign in and order, when they last did, who is
 * waiting for approval. Contact turnover is "remove the old login, done" — removal also
 * ends any signed-in session for that address, and never touches the store's history.
 */
export function AuthorizedContactsDialog({
  customer,
  open,
  onOpenChange,
}: {
  customer: { id: string; businessName: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [newEmail, setNewEmail] = useState("");
  const key = ["/api/wholesale/customers/" + (customer?.id ?? ""), "contacts"] as const;

  const { data: rows = [], isLoading } = useQuery<ContactRow[]>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch(`/api/wholesale/customers/${customer!.id}/contacts`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load contacts");
      return res.json();
    },
    enabled: open && !!customer,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
    queryClient.invalidateQueries({ queryKey: ["/api/wholesale/link-requests"] });
  };
  const onErr = (title: string) => (e: any) => toast({ title, description: e.message, variant: "destructive" });

  const add = useMutation({
    mutationFn: async (email: string) => apiRequest("POST", `/api/wholesale/customers/${customer!.id}/contacts`, { email }),
    onSuccess: () => { refresh(); setNewEmail(""); toast({ title: "Contact added" }); },
    onError: onErr("Couldn't add that email"),
  });
  const remove = useMutation({
    mutationFn: async (email: string) => apiRequest("DELETE", `/api/wholesale/customers/${customer!.id}/contacts/${encodeURIComponent(email)}`),
    onSuccess: () => { refresh(); toast({ title: "Contact removed", description: "They can no longer sign in to this store." }); },
    onError: onErr("Couldn't remove that email"),
  });
  const makePrimary = useMutation({
    mutationFn: async (email: string) => apiRequest("POST", `/api/wholesale/customers/${customer!.id}/contacts/primary`, { email }),
    onSuccess: () => { refresh(); toast({ title: "Primary contact updated" }); },
    onError: onErr("Couldn't change the primary contact"),
  });

  const sorted = [...rows].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || Number(!!b.pendingRequestId) - Number(!!a.pendingRequestId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Authorized contacts</DialogTitle>
          <DialogDescription>
            {customer?.businessName} — who can sign in and order for this store. Removing a contact ends their access; it never touches the store's orders or invoices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="rounded-md border divide-y">
              {sorted.map((c) => (
                <div key={c.email} className="px-3 py-2.5 flex flex-wrap items-center justify-between gap-2" data-testid={`contact-${c.email}`}>
                  <div className="min-w-0">
                    <div className="font-medium break-all">{c.email}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2">
                      {c.isPrimary && <span>Primary</span>}
                      {c.pendingRequestId ? (
                        <Badge variant="secondary" className="h-5">Pending</Badge>
                      ) : (
                        <>
                          {c.addedBy === "domain-match" && <span>Added by domain match</span>}
                          {c.addedBy === "approved" && <span>Approved request</span>}
                          <span>{c.lastOrderedAt ? `Last ordered ${format(new Date(c.lastOrderedAt), "MMM d, yyyy")}` : "No orders from this login yet"}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {c.pendingRequestId ? (
                    <RequestActions request={{ id: c.pendingRequestId, email: c.email, businessName: customer?.businessName }} />
                  ) : (
                    <div className="flex gap-1">
                      {!c.isPrimary && (
                        <Button variant="ghost" size="sm" onClick={() => makePrimary.mutate(c.email)} disabled={makePrimary.isPending} data-testid={`button-primary-${c.email}`}>
                          Make primary
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={c.isPrimary || remove.isPending}
                        title={c.isPrimary ? "Make another email primary first" : undefined}
                        onClick={() => { if (window.confirm(`Remove ${c.email} from ${customer?.businessName}? They won't be able to sign in.`)) remove.mutate(c.email); }}
                        data-testid={`button-remove-${c.email}`}
                      >
                        Remove
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              {sorted.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">No contacts yet.</p>}
            </div>
          )}

          <div>
            <Label htmlFor="new-contact-email">Add a contact email</Label>
            <div className="flex gap-2 mt-1.5">
              <Input
                id="new-contact-email"
                type="email"
                placeholder="name@store.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newEmail.trim()) { e.preventDefault(); add.mutate(newEmail.trim()); } }}
                data-testid="input-new-email"
              />
              <Button onClick={() => add.mutate(newEmail.trim())} disabled={!newEmail.trim() || add.isPending} data-testid="button-add-email">
                Add
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">They sign in with the email alone — no password, nothing to send them. No email goes out when you add someone.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-email-dialog">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
