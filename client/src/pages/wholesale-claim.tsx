import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";

/**
 * Claim your store: shown to a verified wholesale login that isn't on an account yet.
 * They start typing their store, pick it, and are connected on the spot — the email is
 * added to the store's contacts and they can order immediately. Staff see every join in
 * the New Contacts feed with one-click removal. (Pending/denied states remain only for
 * requests from before the approval gate was dropped, 2026-08-23.)
 */

type Match = { id: string; businessName: string; street: string | null; city: string | null; locationCount: number };
type PendingOrder = { summary: string; heldAt: string } | null;
type ClaimStatus =
  | { state: "linked"; customer: { id: string; businessName: string } }
  | { state: "pending"; customer: { id: string; businessName: string }; request: { id: string; pendingOrder: PendingOrder; createdAt: string } }
  | { state: "denied"; customer: { id: string; businessName: string }; request: { id: string; decidedAt: string | null } }
  | { state: "none" };

const MIN_CHARS = 2;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

export default function WholesaleClaim() {
  const { user, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: status, isLoading: statusLoading } = useQuery<ClaimStatus>({
    queryKey: ["/api/wholesale/claim/status"],
    enabled: !!user,
  });

  // Not signed in → the login form is where this starts.
  useEffect(() => {
    if (!authLoading && !user) setLocation("/wholesale/login");
  }, [authLoading, user, setLocation]);

  // Already on an account → nothing to claim.
  useEffect(() => {
    if (status?.state === "linked") setLocation("/wholesale-customer/place-order");
  }, [status, setLocation]);

  if (authLoading || !user || statusLoading || !status || status.state === "linked") {
    return (
      <Shell>
        <p className="text-center text-muted-foreground" data-testid="text-claim-loading">Loading…</p>
      </Shell>
    );
  }

  if (status.state === "pending") {
    return <PendingCard status={status} canOrder={user.role === "wholesale_customer"} />;
  }

  return <SearchCard email={user.email || ""} denied={status.state === "denied" ? status : null} />;
}

// ------------------------------------------------------------------------------------------

function SearchCard({ email, denied }: { email: string; denied: Extract<ClaimStatus, { state: "denied" }> | null }) {
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; autoApproved: boolean; customer: { id: string; businessName: string } } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching, error } = useQuery<{ matches: Match[]; message?: string }>({
    queryKey: ["/api/wholesale/claim/search", debounced],
    queryFn: async () => {
      const res = await fetch(`/api/wholesale/claim/search?q=${encodeURIComponent(debounced)}`, { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.message || "Search failed");
      return body;
    },
    enabled: debounced.length >= MIN_CHARS,
    retry: false,
    staleTime: 60_000,
  });

  const matches = debounced.length >= MIN_CHARS ? data?.matches ?? [] : [];
  const single = matches.length === 1 ? matches[0] : null;
  const chosen = useMemo(() => (single ? single : matches.find((m) => m.id === selectedId) ?? null), [single, matches, selectedId]);

  const claim = useMutation({
    mutationFn: async (customerId: string) => apiRequest("POST", "/api/wholesale/claim", { customerId }),
    onSuccess: (res: any) => {
      setResult({ status: res.status, autoApproved: !!res.autoApproved, customer: res.customer });
      queryClient.invalidateQueries({ queryKey: ["/api/wholesale/claim/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    },
    onError: (e: any) => toast({ title: "Couldn't submit that", description: e.message || "Try again.", variant: "destructive" }),
  });

  if (result?.status === "approved") {
    return (
      <Shell>
        <Card>
          <CardHeader>
            <p className="text-xs font-semibold tracking-wider uppercase text-cedar">Connected</p>
            <CardTitle>You're all set</CardTitle>
            <CardDescription>
              {result.autoApproved
                ? `${email} matches the email domain already on this account, so you're connected to ${result.customer.businessName} and can order now.`
                : `This email is now a contact on ${result.customer.businessName} — you can order right away.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button asChild data-testid="button-claim-place-order"><Link href="/wholesale-customer/place-order">Place an order</Link></Button>
              <Button asChild variant="outline" data-testid="button-claim-orders"><Link href="/wholesale-customer/orders">Past orders</Link></Button>
            </div>
            <p className="text-xs text-muted-foreground">Your login is just this email, no password. You'll stay signed in on this device for 30 days.</p>
          </CardContent>
        </Card>
      </Shell>
    );
  }
  if (result?.status === "pending") {
    return <PendingCard status={{ state: "pending", customer: result.customer, request: { id: "", pendingOrder: null, createdAt: new Date().toISOString() } }} canOrder />;
  }

  const applyHref = `/wholesale/apply?email=${encodeURIComponent(email)}`;
  const searched = debounced.length >= MIN_CHARS && !isFetching && !error;

  return (
    <Shell>
      <Card>
        <CardHeader>
          <CardTitle>Which store are you ordering for?</CardTitle>
          <CardDescription>
            {denied
              ? `We couldn't confirm ${email} on ${denied.customer.businessName}. If that was the wrong store, search again — or apply for a new account.`
              : `We didn't recognize ${email} yet. Pick your store and you're in — we'll add this email to its contacts.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="store-name">Store name</Label>
            <Input
              id="store-name"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
              placeholder="Start typing — we'll match it"
              autoFocus
              autoComplete="off"
              data-testid="input-claim-store"
            />
            {query.trim().length > 0 && query.trim().length < MIN_CHARS && (
              <p className="text-xs text-muted-foreground mt-1">Keep typing — at least {MIN_CHARS} characters.</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="text-claim-search-error">{(error as Error).message}</p>
          )}

          {single && (
            <div data-testid="claim-single-match">
              <p className="text-xs font-semibold tracking-wider uppercase text-cedar mb-2">Is this your store?</p>
              <div className="rounded-md bg-muted/60 p-3">
                <div className="font-semibold">{single.businessName}</div>
                <div className="text-sm text-muted-foreground">{[single.street, single.city].filter(Boolean).join(", ") || "No address on file"}{single.locationCount > 1 ? ` · ${single.locationCount} locations` : ""}</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <Button onClick={() => claim.mutate(single.id)} disabled={claim.isPending} data-testid="button-claim-confirm">Yes, that's us</Button>
                <Button variant="outline" onClick={() => { setQuery(""); setDebounced(""); }} data-testid="button-claim-search-again">No, search again</Button>
              </div>
            </div>
          )}

          {matches.length > 1 && (
            <div data-testid="claim-match-list">
              <div className="rounded-md border divide-y overflow-hidden">
                {matches.map((m) => {
                  const sel = m.id === selectedId;
                  return (
                    <button
                      type="button"
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className={`w-full text-left px-3 py-2.5 flex items-start gap-3 ${sel ? "bg-muted" : "bg-card hover:bg-muted/50"}`}
                      aria-pressed={sel}
                      data-testid={`claim-match-${m.id}`}
                    >
                      <span className={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 ${sel ? "border-primary bg-primary" : "border-muted-foreground/50"}`} />
                      <span>
                        <span className="block font-semibold">{m.businessName}</span>
                        <span className="block text-sm text-muted-foreground">{[m.street, m.city].filter(Boolean).join(", ") || "No address on file"}{m.locationCount > 1 ? ` · ${m.locationCount} locations` : ""}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button className="w-full mt-3" disabled={!chosen || claim.isPending} onClick={() => chosen && claim.mutate(chosen.id)} data-testid="button-claim-confirm">
                This is my store
              </Button>
            </div>
          )}

          {searched && matches.length === 0 && (
            <div className="text-center py-2" data-testid="claim-no-match">
              <p className="font-semibold">We don't have “{debounced}” yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-3">
                If you're new to us, apply below — it takes about a minute. If you think we already deliver to you, try the name as it appears on your invoices.
              </p>
              <Button asChild data-testid="button-claim-apply"><Link href={applyHref}>Apply for a wholesale account</Link></Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Don't see it? <Link href={applyHref} className="text-primary font-medium">Apply for a wholesale account</Link>
          </p>
        </CardContent>
      </Card>
    </Shell>
  );
}

// ------------------------------------------------------------------------------------------

function PendingCard({ status, canOrder }: { status: Extract<ClaimStatus, { state: "pending" }>; canOrder: boolean }) {
  const held = status.request.pendingOrder;
  return (
    <Shell>
      <Card>
        <CardHeader>
          <p className="text-xs font-semibold tracking-wider uppercase text-cedar">Waiting for confirmation</p>
          <CardTitle>Thanks — we'll confirm you with {status.customer.businessName}</CardTitle>
          <CardDescription>
            We check new contacts before connecting them to an account, usually the same business day.
            {canOrder ? " You can build your order now; we'll send it through as soon as you're confirmed." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {held && (
            <div className="rounded-md bg-muted/60 p-3 text-sm" data-testid="text-held-order">
              <div className="font-semibold">Your order is saved</div>
              <div className="text-muted-foreground">{held.summary}</div>
            </div>
          )}
          {canOrder && (
            <Button asChild data-testid="button-claim-start-order">
              <Link href="/wholesale-customer/place-order">{held ? "Change your order" : "Start your order"}</Link>
            </Button>
          )}
          <p className="text-xs text-muted-foreground">Need it faster? Call the brewery and we'll confirm on the spot.</p>
        </CardContent>
      </Card>
    </Shell>
  );
}
