import { Link, useLocation } from "wouter";

/**
 * "Deliveries & Routes" is one job with two views — the printable delivery report and the
 * route optimizer. The sidebar has a single entry; these tabs switch between the views.
 */
export function DeliveriesTabs() {
  const [location] = useLocation();
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
            href={t.href}
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
