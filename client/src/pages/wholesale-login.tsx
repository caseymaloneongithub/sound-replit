import { useState, useEffect, useMemo } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * Store-first wholesale ordering (owner decision 2026-08-26): visitors go straight to
 * naming their store, then give an email. The link that arrives signs them in AND
 * connects them to the store they picked, landing on the order page. Known emails always
 * sign in to their own account regardless of the store picked. No password anywhere;
 * sessions last 30 days, so most weeks skip all of this.
 */

type Match = { id: string; businessName: string; street: string | null; city: string | null; locationCount: number };
const MIN_CHARS = 2;

export default function WholesaleLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [redeemingToken, setRedeemingToken] = useState(false);

  // Step 1 — store
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [store, setStore] = useState<Match | null>(null); // confirmed choice
  const [skippedStore, setSkippedStore] = useState(false); // returning customer path

  // Step 2 — email (+ code fallback)
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);

  /**
   * Redeem a magic link on arrival. The email leads with a sign-in button, so most
   * customers land here with ?token=… and never type anything.
   */
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token || redeemingToken) return;

    setRedeemingToken(true);
    (async () => {
      try {
        const data = await apiRequest("POST", "/api/wholesale/verify-magic-link", { token });
        queryClient.setQueryData(["/api/user"], data.user);
        await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
        if (data.needsClaim) {
          // Verified email, no account and no store picked: "which store are you ordering for?"
          setLocation("/wholesale/claim");
          return;
        }
        toast({ title: "You're in", description: "Signed in — you'll stay signed in on this device for 30 days." });
        setLocation("/wholesale-customer/place-order");
      } catch (error: any) {
        // Strip the spent token from the URL so a refresh doesn't retry it and re-toast.
        window.history.replaceState({}, "", "/wholesale/login");
        setRedeemingToken(false);
        // Fixed copy rather than error.message: apiRequest surfaces raw `400: {"message":…}`
        // JSON, and every failure here means the same thing to the customer anyway.
        toast({
          title: "That sign-in link has expired",
          description: "Links are good for 15 minutes and one use. Enter your email below for a fresh one.",
          variant: "destructive",
        });
      }
    })();
    // Runs once on mount; the token is read from the URL, not from React state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
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
    enabled: debounced.length >= MIN_CHARS && !store && !skippedStore,
    retry: false,
    staleTime: 60_000,
  });

  const matches = debounced.length >= MIN_CHARS ? data?.matches ?? [] : [];
  const single = matches.length === 1 ? matches[0] : null;
  const chosen = useMemo(() => (single ? single : matches.find((m) => m.id === selectedId) ?? null), [single, matches, selectedId]);
  const onEmailStep = !!store || skippedStore;

  const sendLink = async () => {
    if (!email.trim()) {
      toast({ title: "Enter your email", variant: "destructive" });
      return;
    }
    setSending(true);
    try {
      await apiRequest("POST", "/api/wholesale/send-email-code", {
        email: email.trim(),
        ...(store ? { claimCustomerId: store.id } : {}),
      });
      setSent(true);
      toast({ title: "Check your email", description: "The link signs you in and takes you straight to ordering. There's a 6-digit code too if that's easier." });
    } catch (error: any) {
      toast({ title: "Couldn't send", description: error.message || "Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  const verifyCode = async () => {
    if (code.length !== 6) {
      toast({ title: "Enter the 6-digit code from the email", variant: "destructive" });
      return;
    }
    setVerifying(true);
    try {
      const data = await apiRequest("POST", "/api/wholesale/verify-email-code", { email: email.trim(), code });
      queryClient.setQueryData(["/api/user"], data.user);
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      if (data.needsClaim) {
        setTimeout(() => setLocation("/wholesale/claim"), 100);
        return;
      }
      toast({ title: "You're in", description: "You'll stay signed in on this device for 30 days." });
      setTimeout(() => setLocation("/wholesale-customer/place-order"), 100);
    } catch (error: any) {
      toast({ title: "That code didn't work", description: "Codes are good for 15 minutes. Re-send if it's been a while.", variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  // Arriving from a magic link: show progress rather than flashing the form at someone
  // who is already being signed in.
  if (redeemingToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground" data-testid="text-signing-in">Signing you in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/20 p-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Order online</CardTitle>
            {!onEmailStep && (
              <CardDescription>
                Start typing your store and pick it from the list. Ordered with us online before? Skip straight to your email below.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {!onEmailStep && (
              <>
                <div>
                  <Label htmlFor="store">Your store</Label>
                  <Input
                    id="store"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setSelectedId(null); }}
                    placeholder="Start typing — we'll match it"
                    autoFocus
                    autoComplete="off"
                    data-testid="input-store-search"
                  />
                </div>

                {error && <p className="text-sm text-destructive" data-testid="text-store-search-error">{(error as Error).message}</p>}

                {single && (
                  <div data-testid="single-store-match">
                    <div className="rounded-md bg-muted/60 p-3">
                      <div className="font-semibold">{single.businessName}</div>
                      <div className="text-sm text-muted-foreground">{[single.street, single.city].filter(Boolean).join(", ") || "No address on file"}{single.locationCount > 1 ? ` · ${single.locationCount} locations` : ""}</div>
                    </div>
                    <Button className="w-full mt-3" onClick={() => setStore(single)} data-testid="button-confirm-store">
                      This is my store
                    </Button>
                  </div>
                )}

                {matches.length > 1 && (
                  <div data-testid="store-match-list">
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
                            data-testid={`store-match-${m.id}`}
                          >
                            <span className={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 shrink-0 ${sel ? "border-primary bg-primary" : "border-muted-foreground/50"}`} />
                            <span>
                              <span className="block font-semibold">{m.businessName}</span>
                              <span className="block text-sm text-muted-foreground">{[m.street, m.city].filter(Boolean).join(", ")}{m.locationCount > 1 ? ` · ${m.locationCount} locations` : ""}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <Button className="w-full mt-3" disabled={!chosen} onClick={() => chosen && setStore(chosen)} data-testid="button-confirm-store">
                      This is my store
                    </Button>
                  </div>
                )}

                {debounced.length >= MIN_CHARS && !isFetching && !error && matches.length === 0 && (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-store-match">
                    No match — try the name as it appears on your invoices, or{" "}
                    <Link href="/wholesale/apply" className="text-primary font-medium">apply for a wholesale account</Link>.
                  </p>
                )}

                <p className="text-sm text-muted-foreground pt-1">
                  Ordered online before?{" "}
                  <button type="button" className="text-primary font-medium" onClick={() => setSkippedStore(true)} data-testid="button-skip-store">
                    Skip to your email
                  </button>
                </p>
              </>
            )}

            {onEmailStep && (
              <>
                {store && (
                  <div className="flex items-center justify-between rounded-md bg-muted/60 px-3 py-2 text-sm" data-testid="chip-chosen-store">
                    <span><span className="font-semibold">{store.businessName}</span><span className="text-muted-foreground"> · {[store.street, store.city].filter(Boolean).join(", ")}</span></span>
                    <button type="button" className="text-primary font-medium" onClick={() => { setStore(null); setSent(false); }} data-testid="button-change-store">Change</button>
                  </div>
                )}
                <div>
                  <Label htmlFor="email">Your email</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@yourstore.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={sent}
                      autoFocus
                      data-testid="input-wholesale-email-login"
                      onKeyDown={(e) => { if (e.key === "Enter" && !sent) { e.preventDefault(); sendLink(); } }}
                    />
                    <Button type="button" onClick={sendLink} disabled={sending || sent || !email.trim()} data-testid="button-send-wholesale-email-code">
                      {sending ? "Sending…" : sent ? "Sent" : "Email me a link"}
                    </Button>
                  </div>
                </div>

                {sent && (
                  <div>
                    <Label htmlFor="code">Or enter the 6-digit code from the email</Label>
                    <div className="flex gap-2 mt-1">
                      <Input
                        id="code"
                        placeholder="123456"
                        maxLength={6}
                        inputMode="numeric"
                        value={code}
                        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                        data-testid="input-wholesale-email-verification-code"
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); verifyCode(); } }}
                      />
                      <Button type="button" onClick={verifyCode} disabled={verifying || code.length !== 6} data-testid="button-wholesale-email-login-submit">
                        {verifying ? "Checking…" : "Continue"}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Link and code are good for 15 minutes.{" "}
                      <button type="button" className="text-primary font-medium" onClick={() => { setSent(false); setCode(""); }} data-testid="button-wholesale-resend-email-code">
                        Re-send
                      </button>
                    </p>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <div className="text-center mt-6 space-y-2">
          <p className="text-sm text-muted-foreground">
            Want to carry our kombucha?{" "}
            <Link href="/wholesale/apply" className="text-primary hover:underline" data-testid="link-to-wholesale-apply">
              Apply for a wholesale account
            </Link>
          </p>
          <p className="text-sm text-muted-foreground">
            Looking for retail shopping?{" "}
            <Link href="/auth" className="text-primary hover:underline" data-testid="link-to-retail-login">
              Go to retail login
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
