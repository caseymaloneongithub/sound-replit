import { useState } from "react";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";

/**
 * "Deliveries & Routes" is one job with two views — the printable delivery report and the
 * route optimizer. The sidebar has a single entry; these tabs switch between the views.
 *
 * Both views work off ONE date (owner decision 2026-08-30): it lives in the URL as
 * ?date=YYYY-MM-DD, the tab links carry it across, and useSharedDeliveryDate() is the
 * single way either page reads or writes it.
 */

function readSharedDate(): Date {
  const raw = new URLSearchParams(window.location.search).get("date");
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number);
    const parsed = new Date(y, m - 1, d);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

export function useSharedDeliveryDate(): [Date, (d: Date) => void] {
  const [date, setDate] = useState<Date>(readSharedDate);
  const set = (d: Date) => {
    setDate(d);
    const url = new URL(window.location.href);
    url.searchParams.set("date", format(d, "yyyy-MM-dd"));
    window.history.replaceState(null, "", url.toString());
  };
  return [date, set];
}

export function DeliveriesTabs() {
  const [location] = useLocation();
  const dateParam = new URLSearchParams(window.location.search).get("date");
  const suffix = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? `?date=${dateParam}` : "";
  const tabs = [
    { title: "Delivery report", href: "/staff-portal/wholesale/delivery-report" },
    { title: "Routes", href: "/staff-portal/wholesale/delivery-routes" },
  ];
  return (
    <div className="mb-6 inline-flex rounded-lg border bg-muted/40 p-1 print:hidden" data-testid="deliveries-tabs">
      {tabs.map((t) => {
        const active = location === t.href || location.startsWith(t.href + "/");
        return (
          <Link
            key={t.href}
            href={t.href + suffix}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${active ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            data-testid={`tab-${t.title.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {t.title}
          </Link>
        );
      })}
    </div>
  );
}
