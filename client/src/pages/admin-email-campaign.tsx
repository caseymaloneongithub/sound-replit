import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bold, List, Loader2, Send } from "lucide-react";

type RetailCustomer = { id: string; firstName: string | null; lastName: string | null; email: string | null };
type WholesaleCustomer = { id: string; businessName: string; contactName: string | null; email: string };
type CampaignStatus = {
  startedAt: string; audience: string; subject: string; total: number;
  sent: number; failed: Array<{ email: string; error: string }>; done: boolean; logOnly: boolean;
} | null;

type Recipient = { key: string; name: string; email: string };

/**
 * Email campaigns (owner, 2026-09-11): pick an audience (retail or wholesale),
 * untick anyone who shouldn't get it, paste the announcement — bold and bullets
 * survive the paste — and send. The server wraps the body in the standard brand
 * header/footer and drips one email per recipient in the background; this page
 * polls for progress.
 */
export default function AdminEmailCampaign() {
  const { toast } = useToast();
  const [audience, setAudience] = useState<"retail" | "wholesale">("retail");
  // Deselected keys per audience — default is everyone selected.
  const [deselected, setDeselected] = useState<Record<string, Set<string>>>({ retail: new Set(), wholesale: new Set() });
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [polling, setPolling] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const { data: retailCustomers = [] } = useQuery<RetailCustomer[]>({ queryKey: ["/api/retail/customers"] });
  const { data: wholesaleCustomers = [] } = useQuery<WholesaleCustomer[]>({ queryKey: ["/api/wholesale/customers"] });

  const { data: status } = useQuery<CampaignStatus>({
    queryKey: ["/api/admin/email-campaign/status"],
    refetchInterval: polling ? 2000 : false,
  });
  useEffect(() => {
    if (polling && status?.done) setPolling(false);
  }, [polling, status?.done]);

  const recipients: Recipient[] = useMemo(() => {
    if (audience === "retail") {
      return retailCustomers
        .filter((c) => !!c.email)
        .map((c) => ({ key: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email!, email: c.email! }));
    }
    return wholesaleCustomers
      .filter((c) => !!c.email)
      .map((c) => ({ key: c.id, name: c.businessName + (c.contactName ? ` — ${c.contactName}` : ""), email: c.email }));
  }, [audience, retailCustomers, wholesaleCustomers]);

  const visible = recipients.filter(
    (r) => !search.trim() || (r.name + " " + r.email).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const off = deselected[audience];
  const selected = recipients.filter((r) => !off.has(r.key));

  const toggle = (key: string) =>
    setDeselected((prev) => {
      const next = new Set(prev[audience]);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...prev, [audience]: next };
    });
  const setAll = (on: boolean) =>
    setDeselected((prev) => ({ ...prev, [audience]: on ? new Set() : new Set(recipients.map((r) => r.key)) }));

  // Serialize the contentEditable into clean semantic HTML. Pasted content from
  // Word/Google Docs encodes bold as styled <span>s — computed style decides,
  // so bolding and bullets survive no matter which editor they came from.
  const serialize = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return (node.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    let inner = Array.from(el.childNodes).map(serialize).join("");
    const style = el.style;
    const weight = style.fontWeight;
    if (tag === "b" || tag === "strong" || weight === "bold" || Number(weight) >= 600) inner = `<strong>${inner}</strong>`;
    if (tag === "i" || tag === "em" || style.fontStyle === "italic") inner = `<em>${inner}</em>`;
    if (tag === "u" || style.textDecoration?.includes("underline")) inner = `<u>${inner}</u>`;
    switch (tag) {
      case "br": return "<br>";
      case "ul": return `<ul>${inner}</ul>`;
      case "ol": return `<ol>${inner}</ol>`;
      case "li": return `<li>${inner}</li>`;
      case "h1": case "h2": case "h3": return `<${tag}>${inner}</${tag}>`;
      case "blockquote": return `<blockquote>${inner}</blockquote>`;
      case "a": {
        const href = el.getAttribute("href") ?? "";
        return /^https?:\/\//i.test(href) ? `<a href="${href}">${inner}</a>` : inner;
      }
      case "p": case "div": return inner.trim() ? `<p>${inner}</p>` : "";
      default: return inner; // spans and anything else: contents only
    }
  };
  const bodyHtml = () => (editorRef.current ? Array.from(editorRef.current.childNodes).map(serialize).join("") : "");

  const exec = (command: string) => {
    editorRef.current?.focus();
    document.execCommand(command);
  };

  const sendMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", "/api/admin/email-campaign", {
        audience,
        subject: subject.trim(),
        bodyHtml: bodyHtml(),
        recipients: selected.map((r) => ({ email: r.email, name: r.name })),
      }),
    onSuccess: (data: any) => {
      setConfirmOpen(false);
      setPolling(true);
      toast({ title: "Campaign started", description: `Sending to ${data.queued} recipient(s).` });
    },
    onError: (error: any) => {
      setConfirmOpen(false);
      toast({ title: "Couldn't start the campaign", description: error.message || "Try again.", variant: "destructive" });
    },
  });

  const readyToSend = subject.trim().length > 0 && selected.length > 0;
  const sending = polling && status && !status.done;

  return (
    <StaffLayout>
      <div className="p-6 space-y-6 max-w-5xl">
        <div>
          <h1 className="text-2xl font-bold">Email Campaign</h1>
          <p className="text-muted-foreground">Send a branded update to your retail or wholesale customers.</p>
        </div>

        {status && (
          <Card>
            <CardContent className="pt-6 flex items-center gap-3" data-testid="campaign-progress">
              {!status.done && <Loader2 className="w-4 h-4 animate-spin" />}
              <div className="text-sm">
                <span className="font-medium">{status.done ? "Last campaign" : "Sending"}:</span>{" "}
                "{status.subject}" — {status.sent}/{status.total} sent
                {status.failed.length > 0 && <span className="text-destructive"> · {status.failed.length} failed</span>}
                {status.logOnly && <Badge variant="outline" className="ml-2">log-only (no mail configured)</Badge>}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <Card>
            <CardHeader>
              <CardTitle>Recipients</CardTitle>
              <CardDescription>Everyone starts selected — untick anyone who shouldn't get this.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={audience} onValueChange={(v) => setAudience(v as "retail" | "wholesale")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="retail" data-testid="tab-audience-retail">Retail</TabsTrigger>
                  <TabsTrigger value="wholesale" data-testid="tab-audience-wholesale">Wholesale</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex items-center gap-2">
                <Input placeholder="Search name or email…" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-recipient-search" />
                <Button type="button" variant="outline" size="sm" onClick={() => setAll(true)} data-testid="button-select-all">All</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setAll(false)} data-testid="button-select-none">None</Button>
              </div>
              <p className="text-sm text-muted-foreground" data-testid="text-selected-count">
                <span className="font-semibold text-foreground">{selected.length}</span> of {recipients.length} selected
              </p>
              <div className="border rounded-md max-h-96 overflow-y-auto divide-y" data-testid="list-recipients">
                {visible.map((r) => (
                  <label key={r.key} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover-elevate">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={!off.has(r.key)}
                      onChange={() => toggle(r.key)}
                      data-testid={`checkbox-recipient-${r.key}`}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium truncate">{r.name}</span>
                      <span className="block text-xs text-muted-foreground truncate">{r.email}</span>
                    </span>
                  </label>
                ))}
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
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <Label>Body</Label>
                    <div className="flex gap-1">
                      <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => exec("bold")} aria-label="Bold" data-testid="button-format-bold">
                        <Bold className="w-3.5 h-3.5" />
                      </Button>
                      <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => exec("insertUnorderedList")} aria-label="Bulleted list" data-testid="button-format-bullets">
                        <List className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div
                    ref={editorRef}
                    contentEditable
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Email body"
                    className="min-h-48 rounded-md border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:font-bold"
                    data-testid="editor-campaign-body"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-6 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-muted-foreground max-w-xs">
                  Each recipient gets their own email (no CC), with a reply-to-unsubscribe note in the footer.
                </p>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!readyToSend || !!sending || sendMutation.isPending}
                  data-testid="button-open-send"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send to {selected.length}…
                </Button>
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
              "{subject.trim()}" goes to {selected.length} {audience} customer{selected.length === 1 ? "" : "s"}. This can't be recalled once it starts.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} data-testid="button-cancel-send">Cancel</Button>
            <Button onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending} data-testid="button-confirm-send">
              {sendMutation.isPending ? "Starting…" : `Send to ${selected.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
