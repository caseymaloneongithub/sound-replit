import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { endOfWeek, format, startOfDay, startOfWeek, subWeeks } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShoppingCart,
  Users,
  FileText,
  TruckIcon,
  DollarSign,
  UserCog,
  Building2,
  Palette,
  ShoppingBag,
  Box,
  Repeat,
  Receipt,
  Tags,
  Landmark,
  Calculator,
  FileCheck,
  ClipboardCheck,
  Boxes,
  Building,
  FlaskConical,
  Factory,
  PackageCheck,
  LayoutDashboard,
  CalendarDays,
  FileSpreadsheet,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useNewContactCount } from "@/components/staff/contact-requests-panel";
import { isTaskDueInWeek, getTaskDueDateInWeek } from "@/lib/checklist-recurrence";
import type { AdminTask, AdminTaskCompletion } from "@shared/schema";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  /** Show the "Admin" pill — only for admin items inside sections staff can also see. */
  adminBadge?: boolean;
  /** Extra paths that keep this item highlighted (e.g. the second tab of a merged page). */
  alsoMatch?: string[];
  /** Live to-do count; rendered only when > 0. */
  count?: number;
}

interface NavSection {
  title: string;
  adminOnly?: boolean;
  items: NavItem[];
}

/**
 * Overdue checklist items across the prior 4 weeks — same queries and the same recurrence
 * rules as the Weekly Checklist page (shared via lib/checklist-recurrence), so the badge
 * and the page always agree.
 */
function useOverdueChecklistCount(): number {
  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 0 });
  const priorStart = format(subWeeks(currentWeekStart, 4), "yyyy-MM-dd");
  const priorEnd = format(endOfWeek(subWeeks(currentWeekStart, 1), { weekStartsOn: 0 }), "yyyy-MM-dd");

  const { data: tasks = [] } = useQuery<AdminTask[]>({
    queryKey: ["/api/admin-tasks"],
    staleTime: 5 * 60_000,
  });
  const { data: priorCompletions = [] } = useQuery<AdminTaskCompletion[]>({
    queryKey: ["/api/admin-tasks/completions/by-week", priorStart, priorEnd],
    queryFn: async () => {
      const res = await fetch(`/api/admin-tasks/completions/by-week?start=${priorStart}&end=${priorEnd}`);
      if (!res.ok) throw new Error("Failed to fetch prior completions");
      return res.json();
    },
    staleTime: 60_000,
  });

  let count = 0;
  for (let i = 1; i <= 4; i++) {
    const weekStart = subWeeks(currentWeekStart, i);
    const weekEnd = endOfWeek(weekStart, { weekStartsOn: 0 });
    for (const task of tasks) {
      if (!task.isActive || !isTaskDueInWeek(task, weekStart, weekEnd)) continue;
      const due = getTaskDueDateInWeek(task, weekStart, weekEnd);
      if (!due) continue;
      const done = priorCompletions.some(
        (c) => c.taskId === task.id && startOfDay(new Date(c.instanceDate)).getTime() === startOfDay(due).getTime()
      );
      if (!done) count++;
    }
  }
  return count;
}

interface StaffSidebarProps {
  onLinkClick?: () => void;
}

export function StaffSidebar({ onLinkClick }: StaffSidebarProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  const overdueCount = useOverdueChecklistCount();
  const newContactCount = useNewContactCount();

  // Check if user has elevated privileges (admin or super_admin)
  const isElevated = user?.role === "admin" || user?.role === "super_admin";

  // Ordered by how often each page is touched: daily work first, setup and money last.
  // Admin-only pages cluster into admin-only sections so staff never see stubs of things
  // they can't open; the "Admin" pill appears only on Invoices, the one admin item left
  // inside a shared section.
  const navSections: NavSection[] = [
    {
      title: "Today",
      items: [
        { title: "Orders Board", href: "/staff-portal/orders-board", icon: CalendarDays },
        { title: "Weekly Checklist", href: "/staff-portal/checklist", icon: ClipboardCheck, count: overdueCount },
      ],
    },
    {
      title: "Wholesale",
      items: [
        { title: "Orders", href: "/staff-portal/wholesale/orders", icon: FileText },
        { title: "Place Order", href: "/staff-portal/wholesale/place-order", icon: ShoppingCart },
        { title: "Customers", href: "/staff-portal/wholesale/customers", icon: Users, count: newContactCount },
        {
          title: "Deliveries & Routes",
          href: "/staff-portal/wholesale/delivery-report",
          icon: TruckIcon,
          alsoMatch: ["/staff-portal/wholesale/delivery-routes"],
        },
        { title: "Leads", href: "/crm", icon: Building2 },
        { title: "Invoices", href: "/staff-portal/wholesale/invoices", icon: FileCheck, adminOnly: true, adminBadge: true },
      ],
    },
    {
      title: "Retail",
      items: [
        { title: "Orders", href: "/retail/orders", icon: ShoppingCart },
        { title: "Customers", href: "/retail/customers", icon: Users },
        { title: "Subscriptions", href: "/retail/subscriptions", icon: Repeat },
      ],
    },
    {
      title: "Brewing & Inventory",
      items: [
        { title: "Dashboard", href: "/inventory/dashboard", icon: LayoutDashboard },
        { title: "Productions", href: "/inventory/productions", icon: Factory },
        { title: "Recipes", href: "/inventory/recipes", icon: FlaskConical },
        { title: "Materials", href: "/inventory/materials", icon: Boxes },
        { title: "Purchase Orders", href: "/inventory/purchase-orders", icon: PackageCheck },
        { title: "Suppliers", href: "/inventory/suppliers", icon: Building },
      ],
    },
    {
      title: "Catalog",
      adminOnly: true,
      items: [
        { title: "Flavors", href: "/admin/flavors", icon: Palette, adminOnly: true },
        { title: "Retail Products", href: "/admin/retail-products", icon: ShoppingBag, adminOnly: true },
        { title: "Wholesale Units", href: "/admin/wholesale-units", icon: Box, adminOnly: true },
      ],
    },
    {
      title: "Money",
      // Money is admin-and-up territory (owner, 2026-08-31) — staff see operations,
      // not revenue.
      adminOnly: true,
      items: [
        { title: "Revenue", href: "/reports", icon: DollarSign },
        { title: "Accounting", href: "/admin/accounting", icon: Calculator, adminOnly: true },
        { title: "Filing Numbers", href: "/admin/filing-numbers", icon: FileSpreadsheet, adminOnly: true },
        { title: "Transactions", href: "/admin/accounting/transactions", icon: Receipt, adminOnly: true },
        { title: "Categories", href: "/admin/accounting/categories", icon: Tags, adminOnly: true },
        { title: "Bank Connections", href: "/admin/accounting/banks", icon: Landmark, adminOnly: true },
      ],
    },
    {
      title: "Admin",
      adminOnly: true,
      items: [{ title: "User Management", href: "/user-management", icon: UserCog, adminOnly: true }],
    },
  ];

  return (
    <aside className="w-64 border-r bg-card/50 min-h-screen">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-1">Staff & Admin</h2>
        <p className="text-sm text-muted-foreground">Management Portal</p>
      </div>

      <nav className="px-3 space-y-6 pb-8">
        {navSections.map((section) => {
          if (section.adminOnly && !isElevated) return null;
          const visibleItems = section.items.filter((item) => !item.adminOnly || isElevated);
          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title}>
              <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  // /admin/accounting has child routes that are their own nav items, so it
                  // only highlights on exact match.
                  const isExactMatchRoute = item.href === "/admin/accounting";
                  const matches = (href: string) => location === href || location.startsWith(href + "/");
                  const isActive = isExactMatchRoute
                    ? location === item.href
                    : matches(item.href) || (item.alsoMatch ?? []).some(matches);

                  return (
                    <Button
                      key={item.href}
                      variant={isActive ? "default" : "ghost"}
                      className="w-full justify-start gap-3"
                      data-testid={`staff-nav-${item.href.replace(/\//g, "-")}`}
                      asChild
                      onClick={onLinkClick}
                    >
                      <Link href={item.href}>
                        <Icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {item.count ? (
                          <span className="ml-auto rounded-full bg-cedar px-2 py-0.5 text-xs font-semibold text-white" data-testid={`nav-count-${item.href.replace(/\//g, "-")}`}>
                            {item.count}
                          </span>
                        ) : item.adminBadge ? (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            Admin
                          </Badge>
                        ) : null}
                      </Link>
                    </Button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
