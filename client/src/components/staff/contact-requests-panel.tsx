import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type LinkRequestRow = {
  id: string;
  email: string;
  status: string;
  autoApproved: boolean;
  pendingOrder: { summary: string; heldAt: string } | null;
  placedOrderId: string | null;
  denyReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  customerId: string;
  businessName: string;
};

function requestsQuery(status: string) {
  return {
    queryKey: ["/api/wholesale/link-requests", status] as const,
    queryFn: async () => {
      const res = await fetch(`/api/wholesale/link-requests?status=${status}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load contact requests");
      return res.json() as Promise<LinkRequestRow[]>;
    },
  };
}

export function usePendingLinkRequests() {
  return useQuery<LinkRequestRow[]>({ ...requestsQuery("pending"), refetchInterval: 60_000 });
}

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/wholesale/link-requests"] });
  queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/wholesale/customers/") });
}

/** Approve / Deny buttons for one request. Only legacy pending rows still use this —
 *  self-joins connect immediately now — but the endpoints and UI stay for any stragglers. */
export function RequestActions({ request, size = "sm" }: { request: { id: string; email: string; businessName?: string }; size?: "sm" | "default" }) {
  const { toast } = useToast();
  const [denyOpen, setDenyOpen] = useState(false);
  const [reason, setReason] = useState("");

  const approve = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/wholesale/link-requests/${request.id}/approve`, {}),
    onSuccess: (res: any) => {
      invalidateAll();
      toast({
        title: `${request.email} approved`,
        description: res?.placedOrderId
          ? "Their held order has been placed."
          : res?.orderError
            ? `Approved, but their held order failed: ${res.orderError}`
            : undefined,
        variant: res?.orderError ? "destructive" : undefined,
      });
    },
    onError: (e: any) => toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
  });
  const deny = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/wholesale/link-requests/${request.id}/deny`, { reason }),
    onSuccess: () => {
      invalidateAll();
      setDenyOpen(false);
      setReason("");
      toast({ title: `${request.email} denied` });
    },
    onError: (e: any) => toast({ title: "Deny failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <div className="flex gap-2">
        <Button size={size} onClick={() => approve.mutate()} disabled={approve.isPending || deny.isPending} data-testid={`button-approve-request-${request.id}`}>
          {approve.isPending ? "Approving…" : "Approve"}
        </Button>
        <Button size={size} variant="outline" onClick={() => setDenyOpen(true)} disabled={approve.isPending || deny.isPending} data-testid={`button-deny-request-${request.id}`}>
          Deny
        </Button>
      </div>
      <Dialog open={denyOpen} onOpenChange={setDenyOpen}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Deny {request.email}?</DialogTitle>
            <DialogDescription>
              They won't be connected{request.businessName ? ` to ${request.businessName}` : ""}. The reason is kept for staff only — nothing is sent to them.
            </DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional: why (for your records)" rows={3} data-testid="input-deny-reason" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDenyOpen(false)} data-testid="button-cancel-deny">Cancel</Button>
            <Button variant="destructive" onClick={() => deny.mutate()} disabled={deny.isPending} data-testid="button-confirm-deny">
              {deny.isPending ? "Denying…" : "Deny request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Self-joins connect immediately (owner decision 2026-08-23), so oversight lives here:
 * every contact who added themselves in the last 14 days, with one-click removal. Legacy
 * pending rows (from before the gate was dropped) still show with Approve/Deny.
 */
export function ContactRequestsPanel() {
  const { toast } = useToast();
  const { data: pending = [] } = usePendingLinkRequests();
  const { data: recent = [], isLoading } = useQuery<LinkRequestRow[]>({ ...requestsQuery("recent"), refetchInterval: 60_000 });

  const remove = useMutation({
    mutationFn: async (r: LinkRequestRow) => apiRequest("DELETE", `/api/wholesale/customers/${r.customerId}/contacts/${encodeURIComponent(r.email)}`),
    onSuccess: (_, r) => {
      invalidateAll();
      toast({ title: `${r.email} removed`, description: `No longer able to sign in to ${r.businessName}.` });
    },
    onError: (e: any) => toast({ title: "Couldn't remove contact", description: e.message, variant: "destructive" }),
  });

  if (isLoading || (pending.length === 0 && recent.length === 0)) return null;

  return (
    <Card className="mb-6" data-testid="panel-contact-requests">
      <CardHeader>
        <CardTitle style={{ fontFamily: "var(--font-heading)" }}>
          New contacts
          <span className="ml-2 inline-flex items-center rounded-full bg-cedar px-2 py-0.5 text-xs font-semibold text-white align-middle">{pending.length + recent.length}</span>
        </CardTitle>
        <CardDescription>
          People who verified an email and connected themselves to a store. They can order immediately — remove anyone who doesn't belong.
        </CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {pending.map((r) => (
          <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3" data-testid={`request-${r.id}`}>
            <div className="min-w-0">
              <div className="font-semibold">{r.email}</div>
              <div className="text-sm text-muted-foreground">
                wants to join <span className="font-medium text-foreground">{r.businessName}</span> · {formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}
                {r.pendingOrder?.summary ? <> · order waiting: <span className="text-foreground">{r.pendingOrder.summary}</span></> : null}
              </div>
            </div>
            <RequestActions request={r} />
          </div>
        ))}
        {recent.map((r) => (
          <div key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3" data-testid={`recent-join-${r.id}`}>
            <div className="min-w-0">
              <div className="font-semibold">{r.email}</div>
              <div className="text-sm text-muted-foreground">
                joined <span className="font-medium text-foreground">{r.businessName}</span> · {formatDistanceToNow(new Date(r.decidedAt ?? r.createdAt), { addSuffix: true })}
                {r.autoApproved ? " · email domain matched" : ""}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={() => { if (window.confirm(`Remove ${r.email} from ${r.businessName}?`)) remove.mutate(r); }}
              data-testid={`button-remove-join-${r.id}`}
            >
              Remove
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
