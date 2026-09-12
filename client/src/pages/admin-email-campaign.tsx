import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Send } from "lucide-react";
import { CampaignEditor } from "@/components/campaign-editor";

const MAX_RECIPIENTS = 1000; // mirrors MAX_CAMPAIGN_RECIPIENTS on the server

type RetailCustomer = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type WholesaleAudienceRow = { key: string; businessName: string; locationName: string | null; emails: string[] };
type OptOut = { email: string; createdAt: string };
type CampaignStatus = {
  id: string; subject: string; audience: string; startedAt: string; completedAt: string | null;
  done: boolean; logOnly: boolean; total: number; sent: number; pending: number; skipped: number;
  uncertain: number; failedCount: number;
  failed: Array<{ email: string; error: string }>; // a sample — failedCount is the truth
} | null;

// One selectable row: a retail account, or a wholesale LOCATION (owner,
// 2026-09-11) — which may carry more than one address. Addresses are deduped
// across every selected row before sending, so a shared inbox gets one email.
type Recipient = { key: string; name: string; emails: string[] };

const norm = (e: string) => e.trim().toLowerCase();

/**
 * Email campaigns: pick an audience (retail accounts, or wholesale by
 * location), untick anyone who shouldn't get THIS one, opt out anyone who should
 * never get another (persisted, enforced server-side), paste the announcement —
 * bold and bullets survive the paste — and send. The server persists the
 * campaign and drips one email per address in the background; this page polls.
 */
export default function AdminEmailCampaign() {
  const { toast } = useToast();
  const [audience, setAudience] = useState<"retail" | "wholesale">("retail");
  // Unticked keys per audience for THIS send — default is everyone selected.
  const [deselected, setDeselected] = useState<Record<string, Set<string>>>({ retail: new Set(), wholesale: new Set() });
  const [search, setSearch] = useState("");
  // Addresses typed in by hand (owner, 2026-09-11) — a prospect, a press contact,
  // someone not on either customer list. Live for this page session only, ride
  // along with whichever audience is being sent, and honor opt-outs like any row.
  const [manual, setManual] = useState<Array<{ email: string; name: string }>>([]);
  const [manualEmail, setManualEmail] = useState("");
  const [manualName, setManualName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [messageTab, setMessageTab] = useState<"write" | "preview">("write");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: retailCustomers = [] } = useQuery<RetailCustomer[]>({ queryKey: ["/api/retail/customers"] });
  const { data: wholesaleRows = [] } = useQuery<WholesaleAudienceRow[]>({ queryKey: ["/api/admin/campaign-audience/wholesale"] });
  const { data: optOuts = [] } = useQuery<OptOut[]>({ queryKey: ["/api/admin/marketing-opt-outs"] });
  const optedOut = useMemo(() => new Set(optOuts.map((o) => norm(o.email))), [optOuts]);

  // Polling is derived from the campaign itself: while the latest one is still
  // sending, poll; reopening the page mid-campaign picks that up automatically.
  const { data: status } = useQuery<CampaignStatus>({
    queryKey: ["/api/admin/email-campaign/status"],
    refetchInterval: (query) => (query.state.data && !query.state.data.done ? 2000 : false),
  });
  const sending = !!status && !status.done;

  const recipients: Recipient[] = useMemo(() => {
    const manualRows: Recipient[] = manual.map((m) => ({ key: `manual:${norm(m.email)}`, name: m.name || m.email, emails: [m.email] }));
    if (audience === "retail") {
      return [
        ...manualRows,
        ...retailCustomers
          .filter((c) => !!c.email)
          .map((c) => ({ key: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email!, emails: [c.email!] })),
      ];
    }
    return [
      ...manualRows,
      ...wholesaleRows
        .filter((r) => r.emails.length > 0)
        .map((r) => ({
          key: r.key,
          name: r.locationName && r.locationName !== "Main Location" ? `${r.businessName} — ${r.locationName}` : r.businessName,
          emails: r.emails,
        })),
    ];
  }, [audience, retailCustomers, wholesaleRows, manual]);

  const addManual = () => {
    const email = manualEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast({ title: "That doesn't look like an email address", variant: "destructive" });
      return;
    }
    const already = recipients.some((r) => r.emails.some((e) => norm(e) === norm(email)));
    if (already) {
      toast({ title: "Already on the list", description: `${email} is already a recipient.` });
    } else {
      setManual((prev) => [...prev, { email, name: manualName.trim() }]);
    }
    setManualEmail("");
    setManualName("");
  };
  const removeManual = (key: string) => setManual((prev) => prev.filter((m) => `manual:${norm(m.email)}` !== key));

  // A row is opted out when every address on it is.
  const isOut = (r: Recipient) => r.emails.every((e) => optedOut.has(norm(e)));
  const visible = recipients.filter(
    (r) => !search.trim() || (r.name + " " + r.emails.join(" ")).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const off = deselected[audience];
  const eligible = recipients.filter((r) => !isOut(r));
  const selected = eligible.filter((r) => !off.has(r.key));

  // The actual send list: every address on every selected row, minus opt-outs,
  // one entry per distinct address (first row's name wins for the greeting).
  const sendList = useMemo(() => {
    const seen = new Map<string, { email: string; name: string }>();
    for (const r of selected) {
      for (const e of r.emails) {
        const k = norm(e);
        if (optedOut.has(k) || seen.has(k)) continue;
        seen.set(k, { email: e.trim(), name: r.name });
      }
    }
    return Array.from(seen.values());
  }, [selected, optedOut]);
  const overLimit = sendList.length > MAX_RECIPIENTS;

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev[audience]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [audience]: next };
    });
  const setAll = (on: boolean) =>
    setDeselected((prev) => ({ ...prev, [audience]: on ? new Set() : new Set(recipients.map((r) => r.key)) }));

  // Opt-outs are per ADDRESS, never per row: a location's row can carry two
  // addresses with different histories, and undoing one must not resurrect the
  // other's earlier unsubscribe.
  const optOutMutation = useMutation({
    mutationFn: async ({ email, remove }: { email: string; remove: boolean }) =>
      remove
        ? apiRequest("DELETE", `/api/admin/marketing-opt-outs/${encodeURIComponent(norm(email))}`)
        : apiRequest("POST", "/api/admin/marketing-opt-outs", { email }),
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/marketing-opt-outs"] });
      toast({
        title: vars.remove ? "Opt-out removed" : "Opted out",
        description: vars.remove ? `${vars.email} can receive campaigns again.` : `${vars.email} won't get any future campaign.`,
      });
    },
    onError: (error: any) => toast({ title: "Couldn't update opt-outs", description: error.message, variant: "destructive" }),
  });

  // The editor (Tiptap) hands back clean semantic HTML on every change; the
  // preview asks the server to wrap it in the real brand template so what the
  // admin sees is exactly what the recipients get.
  const [previewKey, setPreviewKey] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setPreviewKey(JSON.stringify({ subject: subject.trim(), bodyHtml })), 350);
    return () => clearTimeout(t);
  }, [subject, bodyHtml]);
  const { data: preview, isFetching: previewLoading, error: previewError, refetch: refetchPreview } = useQuery<{ html: string; text: string }>({
    queryKey: ["campaign-preview", previewKey],
    queryFn: async () => apiRequest("POST", "/api/admin/email-campaign/preview", JSON.parse(previewKey)),
    enabled: messageTab === "preview" && !!previewKey,
    staleTime: Infinity,
    retry: false,
  });

  const sendMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/email-campaign", {
        audience,
        subject: subject.trim(),
        bodyHtml,
        recipients: sendList,
      }),
    onSuccess: (data: any) => {
      setConfirmOpen(false);
      // Fresh status right away so polling starts on THIS campaign, not the
      // cached finished one.
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email-campaign/status"] });
      toast({ title: "Campaign started", description: `Sending to ${data.queued} address(es)${data.skipped ? ` — ${data.skipped} opted out and skipped` : ""}.` });
    },
    onError: (error: any) => {
      setConfirmOpen(false);
      toast({ title: "Couldn't start the campaign", description: error.message || "Try again.", variant: "destructive" });
    },
  });

  // A test copy to the signed-in admin's own inbox — the first move before any
  // real send, and the way to catch a broken paste or a wrong subject.
  const testMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/admin/email-campaign/test", { subject: subject.trim(), bodyHtml }),
    onSuccess: (data: any) => toast({ title: "Test sent", description: `Check ${data.to} for "[TEST] ${subject.trim()}".` }),
    onError: (error: any) => toast({ title: "Couldn't send the test", description: error.message || "Try again.", variant: "destructive" }),
  });

  const readyToSend = subject.trim().length > 0 && sendList.length > 0 && !overLimit;
  const rowWord = audience === "wholesale" ? "location" : "customer";

  return (
    <StaffLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold">Email Campaign</h1>
          <p className="text-muted-foreground">Send a branded update to your retail or wholesale customers.</p>
        </div>

        {status && (
          <Card>
            <CardContent className="pt-6 space-y-2" data-testid="campaign-progress">
              <div className="flex items-center gap-3 text-sm">
                {!status.done && <Loader2 className="w-4 h-4 animate-spin" />}
                <div>
                  <span className="font-medium">{status.done ? "Last campaign" : "Sending"}:</span>{" "}
                  "{status.subject}" — {status.sent}/{status.total - status.skipped} sent
                  {status.skipped > 0 && <span className="text-muted-foreground"> · {status.skipped} opted out</span>}
                  {status.failedCount > 0 && <span className="text-destructive"> · {status.failedCount} failed</span>}
                  {status.uncertain > 0 && (
                    <span className="text-amber-600 dark:text-amber-400" title="A restart interrupted these mid-send; delivery is unknown and they were not re-sent.">
                      {" "}· {status.uncertain} uncertain
                    </span>
                  )}
                  {status.logOnly && <Badge variant="outline" className="ml-2">log-only (no mail configured)</Badge>}
                </div>
              </div>
              {status.failedCount > 0 && (
                <ul className="text-xs text-muted-foreground pl-7 space-y-0.5">
                  {status.failed.map((f) => <li key={f.email}>{f.email} — {f.error}</li>)}
                  {status.failedCount > status.failed.length && (
                    <li className="italic">…and {status.failedCount - status.failed.length} more</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>
                Everyone starts selected — untick anyone who shouldn't get <em>this</em> one. "Opt out" keeps them off every future campaign.
                {audience === "wholesale" && " Wholesale is listed by location; a shared address still gets just one email."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={audience} onValueChange={(v) => { setAudience(v as "retail" | "wholesale"); setSearch(""); }}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="retail" data-testid="tab-audience-retail">Retail</TabsTrigger>
                  <TabsTrigger value="wholesale" data-testid="tab-audience-wholesale">Wholesale</TabsTrigger>
                </TabsList>
              </Tabs>
              <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-recipient-search" />
              <div className="flex items-end gap-2 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <Label htmlFor="manual-email" className="text-xs text-muted-foreground">Add an address by hand</Label>
                  <Input
                    id="manual-email"
                    className="mt-1"
                    type="email"
                    placeholder="someone@example.com"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
                    data-testid="input-manual-email"
                  />
                </div>
                <div className="w-36">
                  <Label htmlFor="manual-name" className="text-xs text-muted-foreground">Name (optional)</Label>
                  <Input
                    id="manual-name"
                    className="mt-1"
                    placeholder="Name"
                    value={manualName}
                    onChange={(e) => setManualName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
                    data-testid="input-manual-name"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" onClick={addManual} disabled={!manualEmail.trim()} data-testid="button-add-manual">Add</Button>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-selected-count">
                <span className="font-semibold text-foreground">{selected.length}</span> of {eligible.length} {rowWord}{eligible.length === 1 ? "" : "s"} selected
                {" · "}<span className="font-semibold text-foreground">{sendList.length}</span> unique address{sendList.length === 1 ? "" : "es"}
                {overLimit && <span className="text-destructive"> — over the {MAX_RECIPIENTS.toLocaleString()} per-campaign limit; untick some or send in batches</span>}
              </p>
              <div className="border rounded-md max-h-96 overflow-y-auto divide-y" data-testid="list-recipients">
                {/* Select-all: checked when everyone eligible is in, indeterminate
                    when only some are, unchecked when none. Opted-out rows aren't
                    eligible and don't count either way. */}
                <label className="flex items-center gap-3 px-3 py-2 bg-muted/40 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={eligible.length > 0 && selected.length === eligible.length}
                    ref={(el) => { if (el) el.indeterminate = selected.length > 0 && selected.length < eligible.length; }}
                    onChange={(e) => setAll(e.target.checked)}
                    aria-label="Select all recipients"
                    data-testid="checkbox-select-all"
                  />
                  <span className="text-sm font-medium">Select all ({eligible.length})</span>
                </label>
                {visible.map((r) => {
                  const out = isOut(r);
                  return (
                    <div key={r.key} className={`flex items-center gap-3 px-3 py-2 ${out ? "opacity-60" : ""}`}>
                      <input
                        type="checkbox"
                        className="rounded"
                        checked={!out && !off.has(r.key)}
                        disabled={out}
                        onChange={() => toggle(r.key)}
                        aria-label={`Include ${r.name}`}
                        data-testid={`checkbox-recipient-${r.key}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">
                          {r.name}
                          {r.key.startsWith("manual:") && <Badge variant="secondary" className="ml-2 text-xs">Added by hand</Badge>}
                          {out && <Badge variant="outline" className="ml-2 text-xs">Opted out</Badge>}
                        </span>
                        {/* Each address carries its own opt-out state and control. */}
                        {r.emails.map((e) => {
                          const eOut = optedOut.has(norm(e));
                          return (
                            <span key={e} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <span className={`truncate ${eOut ? "line-through" : ""}`}>{e}</span>
                              <button
                                type="button"
                                className="shrink-0 hover:text-foreground underline-offset-2 hover:underline"
                                onClick={() => optOutMutation.mutate({ email: e, remove: eOut })}
                                disabled={optOutMutation.isPending}
                                data-testid={`button-optout-${r.key}-${norm(e)}`}
                              >
                                {eOut ? "Undo opt-out" : "Opt out"}
                              </button>
                              {r.key.startsWith("manual:") && (
                                <button
                                  type="button"
                                  className="shrink-0 hover:text-foreground underline-offset-2 hover:underline"
                                  onClick={() => removeManual(r.key)}
                                  data-testid={`button-remove-manual-${r.key}`}
                                >
                                  Remove
                                </button>
                              )}
                            </span>
                          );
                        })}
                      </span>
                    </div>
                  );
                })}
                {visible.length === 0 && <p className="px-3 py-6 text-sm text-muted-foreground text-center">No matches.</p>}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Message</CardTitle>
                <CardDescription>Paste from a doc — bold and bullets are kept. The brand header and footer are added automatically.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label htmlFor="campaign-subject">Subject</Label>
                  <Input
                    id="campaign-subject"
                    className="mt-1.5"
                    placeholder="e.g. Now pouring: our new can lineup"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    maxLength={150}
                    data-testid="input-campaign-subject"
                  />
                </div>
                <Tabs value={messageTab} onValueChange={(v) => setMessageTab(v as "write" | "preview")}>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label>Body</Label>
                    <TabsList className="h-8">
                      <TabsTrigger value="write" className="text-xs" data-testid="tab-message-write">Write</TabsTrigger>
                      <TabsTrigger value="preview" className="text-xs" data-testid="tab-message-preview">Preview email</TabsTrigger>
                    </TabsList>
                  </div>
                  {/* Both panels stay MOUNTED and are shown/hidden — Radix TabsContent
                      would unmount the editor on Preview, throwing away its undo
                      history (an accidental deletion before previewing became
                      unrecoverable). */}
                  <div hidden={messageTab !== "write"}>
                    <CampaignEditor value={bodyHtml} onChange={setBodyHtml} />
                  </div>
                  <div hidden={messageTab !== "preview"}>
                    {/* The server's real template in a sandboxed frame — header, body,
                        footer, unsubscribe link — exactly as it will land. */}
                    <div className="rounded-md border bg-muted/40 overflow-hidden" data-testid="campaign-preview">
                      {previewError ? (
                        <div className="p-6 text-sm space-y-3" data-testid="campaign-preview-error">
                          <p className="text-destructive">Couldn't build the preview: {(previewError as Error).message || "request failed"}</p>
                          <Button type="button" variant="outline" size="sm" onClick={() => refetchPreview()} data-testid="button-retry-preview">Try again</Button>
                        </div>
                      ) : preview ? (
                        <iframe
                          title="Email preview"
                          sandbox=""
                          srcDoc={preview.html}
                          className="w-full h-[32rem] bg-white"
                        />
                      ) : (
                        <p className="p-6 text-sm text-muted-foreground">
                          {previewLoading ? "Building preview…" : bodyHtml ? "Preview will appear in a moment." : "Write something to preview it."}
                        </p>
                      )}
                    </div>
                  </div>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground max-w-xs">
                  Each address gets its own email (no CC) with a one-click unsubscribe link. Up to {MAX_RECIPIENTS.toLocaleString()} per campaign.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => testMutation.mutate()}
                    disabled={subject.trim().length === 0 || testMutation.isPending}
                    data-testid="button-send-test"
                  >
                    {testMutation.isPending ? "Sending…" : "Send a test to me"}
                  </Button>
                  <Button
                    onClick={() => setConfirmOpen(true)}
                    disabled={!readyToSend || sending || sendMutation.isPending}
                    data-testid="button-open-send"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    Send to {sendList.length}…
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this campaign?</DialogTitle>
            <DialogDescription>
              "{subject.trim()}" goes to {sendList.length} unique address{sendList.length === 1 ? "" : "es"} ({selected.length} {audience} {rowWord}{selected.length === 1 ? "" : "s"}). This can't be recalled once it starts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-send">Cancel</Button>
            <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} data-testid="button-confirm-send">
              {sendMutation.isPending ? "Starting…" : `Send to ${sendList.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
