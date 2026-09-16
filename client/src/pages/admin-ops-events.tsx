import { useState } from "react";
import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { StaffLayout } from "@/components/staff/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Check } from "lucide-react";

/**
 * Operational events — super admins only (owner, 2026-09-15). The things that
 * used to be one line in the Railway log: spam drops, receipts with nowhere to
 * go, campaigns that gave up, refunds left pending, webhook failures, billing
 * runs. Alerts are emailed at once and the rest arrive in a 7 a.m. digest; this
 * page is the full list, with Acknowledge for alerts once they're handled.
 */

type OpsEvent = {
  id: string;
  createdAt: string;
  severity: "info" | "warn" | "alert";
  kind: string;
  message: string;
  detail: Record<string, unknown> | null;
  refType: string | null;
  refId: string | null;
  acknowledgedAt: string | null;
};

/** One page from the server; `total` and `openAlerts` arrive with the first page only. */
type EventsPage = {
  events: OpsEvent[];
  nextCursor: string | null;
  total: number | null;
  openAlerts: number | null;
};

const SEVERITY_STYLE: Record<OpsEvent["severity"], string> = {
  alert: "bg-red-100 text-red-800 border-red-200",
  warn: "bg-amber-100 text-amber-800 border-amber-200",
  info: "bg-muted text-muted-foreground",
};

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export default function AdminOpsEvents() {
  const { toast } = useToast();
  const [days, setDays] = useState("7");
  const [severity, setSeverity] = useState("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams({ days });
  if (severity !== "all") params.set("severity", severity);
  if (openOnly) params.set("open", "true");
  const url = `/api/admin/ops-events?${params.toString()}`;
  // Pages are keyed by the cursor of the last row shown, so a long window (a spam
  // burst, a month of billing runs) is walked in full rather than cut off.
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery<EventsPage>({
    queryKey: [url],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(pageParam ? `${url}&before=${encodeURIComponent(String(pageParam))}` : url, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()) || res.statusText}`);
      return res.json();
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const events = data?.pages.flatMap((p) => p.events) ?? [];
  const total = data?.pages[0]?.total ?? events.length;
  const openAlerts = data?.pages[0]?.openAlerts ?? 0;

  const ack = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/admin/ops-events/${id}/acknowledge`),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/ops-events") });
    },
    onError: (e: any) => toast({ title: "Couldn't acknowledge", description: e.message, variant: "destructive" }),
  });

  return (
    <StaffLayout>
      <div className="max-w-5xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-2" style={{ fontFamily: "var(--font-heading)" }}>Site events</h1>
          <p className="text-muted-foreground">
            What the site did that a person should know about. Alerts are emailed as they happen; everything else comes in the 7 a.m. digest.
            {openAlerts > 0 && <span className="ml-2 font-medium text-red-700" data-testid="text-open-alerts">{openAlerts} open alert{openAlerts === 1 ? "" : "s"}</span>}
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center gap-3">
              <Select value={days} onValueChange={setDays}>
                <SelectTrigger className="w-36 h-9" data-testid="select-days"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 24 hours</SelectItem>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Select value={severity} onValueChange={setSeverity}>
                <SelectTrigger className="w-36 h-9" data-testid="select-severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All levels</SelectItem>
                  <SelectItem value="alert">Alerts</SelectItem>
                  <SelectItem value="warn">Warnings</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                </SelectContent>
              </Select>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} data-testid="checkbox-open-only" />
                Unacknowledged only
              </label>
            </div>
            <CardDescription className="pt-2" data-testid="text-event-count">
              {total} event{total === 1 ? "" : "s"}{events.length < total ? ` · showing ${events.length}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : isError ? (
              <p className="p-6 text-destructive">Couldn't load events.</p>
            ) : events.length === 0 ? (
              <p className="p-6 text-muted-foreground" data-testid="text-no-events">Nothing recorded in this window.</p>
            ) : (
              <ul className="divide-y">
                {events.map((e) => (
                  <li key={e.id} className="px-4 py-3" data-testid={`event-${e.id}`}>
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className={`mt-0.5 shrink-0 uppercase text-[10px] tracking-wider ${SEVERITY_STYLE[e.severity]}`}>{e.severity}</Badge>
                      <div className="min-w-0 flex-1">
                        <button type="button" className="text-left text-sm font-medium hover:underline" onClick={() => setExpanded(expanded === e.id ? null : e.id)} data-testid={`button-expand-${e.id}`}>
                          {e.message}
                        </button>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {when(e.createdAt)} · {e.kind}
                          {e.acknowledgedAt && <> · acknowledged {when(e.acknowledgedAt)}</>}
                        </div>
                        {expanded === e.id && e.detail && (
                          <pre className="mt-2 text-xs bg-muted rounded-md p-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(e.detail, null, 2)}</pre>
                        )}
                      </div>
                      {e.severity === "alert" && !e.acknowledgedAt && (
                        <Button size="sm" variant="outline" onClick={() => ack.mutate(e.id)} disabled={ack.isPending} data-testid={`button-ack-${e.id}`}>
                          <Check className="w-3.5 h-3.5 mr-1" /> Acknowledge
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {hasNextPage && (
              <div className="border-t p-3 text-center">
                <Button variant="outline" size="sm" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} data-testid="button-load-more">
                  {isFetchingNextPage ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Show older events
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">The digest</CardTitle>
            <CardDescription>Every morning at 7 a.m. Pacific, the last 24 hours go to super admins by email — grouped like this page, alerts first. Nothing is sent to anyone else.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    </StaffLayout>
  );
}
