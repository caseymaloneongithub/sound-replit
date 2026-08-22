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

export const PENDING_REQUESTS_KEY = ["/api/wholesale/link-requests", "pending"] as const;

export function usePendingLinkRequests() {
  return useQuery<LinkRequestRow[]>({
    queryKey: PENDING_REQUESTS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/wholesale/link-requests?status=pending", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load contact requests");
      return res.json();
    },
    refetchInterval: 60_000,
  });
}

function invalidateAll() {
  queryClient.invalidateQueries({ queryKey: ["/api/wholesale/link-requests"] });
  queryClient.invalidateQueries({ queryKey: ["/api/wholesale/customers"] });
  queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/wholesale/customers/") });
}

/** Approve / Deny buttons for one request. Shared by the queue and the per-store dialog. */
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

/** The queue: every pending "connect me to this store" request, newest first. */
export function ContactRequestsPanel() {
  const { data, isLoading } = usePendingLinkRequests();
  const rows = data ?? [];
  if (isLoading || rows.length === 0) return null;

  return (
    <Card className="mb-6" data-testid="panel-contact-requests">
      <CardHeader>
        <CardTitle style={{ fontFamily: "var(--font-heading)" }}>
          Contact requests <span className="ml-2 inline-flex items-center rounded-full bg-cedar px-2 py-0.5 text-xs font-semibold text-white align-middle">{rows.length}</span>
        </CardTitle>
        <CardDescription>People who verified their email and asked to be connected to a store. Approving connects the login and places any order they built while waiting.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y">
        {rows.map((r) => (
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
      </CardContent>
    </Card>
  );
}
