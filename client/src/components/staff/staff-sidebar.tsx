import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Package,
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
  Route,
  FileCheck
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function StaffSidebar() {
  const [location] = useLocation();
  const { user } = useAuth();

  // Check if user has elevated privileges (admin or super_admin)
  const isElevated = user?.role === 'admin' || user?.role === 'super_admin';

  const navSections: NavSection[] = [
    {
      title: "Product Management",
      items: [
        { title: "Flavor Library", href: "/admin/flavors", icon: Palette, adminOnly: true },
        { title: "Retail Products", href: "/admin/retail-products", icon: ShoppingBag, adminOnly: true },
        { title: "Wholesale Units", href: "/admin/wholesale-units", icon: Box, adminOnly: true },
      ],
    },
    {
      title: "Wholesale",
      items: [
        { title: "Place Order", href: "/staff-portal/wholesale/place-order", icon: ShoppingCart },
        { title: "Orders", href: "/staff-portal/wholesale/orders", icon: FileText },
        { title: "Invoices", href: "/staff-portal/wholesale/invoices", icon: FileCheck, adminOnly: true },
        { title: "Customers", href: "/staff-portal/wholesale/customers", icon: Users },
        { title: "Delivery Report", href: "/staff-portal/wholesale/delivery-report", icon: TruckIcon },
        { title: "Route Optimization", href: "/staff-portal/wholesale/delivery-routes", icon: Route },
      ],
    },
    {
      title: "Retail",
      items: [
        { title: "Orders", href: "/retail/orders", icon: ShoppingCart },
        { title: "Subscriptions", href: "/retail/subscriptions", icon: Repeat },
        { title: "Customers", href: "/retail/customers", icon: Users },
      ],
    },
    {
      title: "Reports",
      items: [
        { title: "Revenue", href: "/reports", icon: DollarSign },
      ],
    },
    {
      title: "Accounting",
      items: [
        { title: "Dashboard", href: "/admin/accounting", icon: Calculator, adminOnly: true },
        { title: "Transactions", href: "/admin/accounting/transactions", icon: Receipt, adminOnly: true },
        { title: "Categories", href: "/admin/accounting/categories", icon: Tags, adminOnly: true },
        { title: "Bank Connections", href: "/admin/accounting/banks", icon: Landmark, adminOnly: true },
      ],
    },
    {
      title: "Administration",
      items: [
        { title: "CRM", href: "/crm", icon: Building2 },
        { title: "User Management", href: "/user-management", icon: UserCog, adminOnly: true },
      ],
    },
  ];

  return (
    <aside className="w-64 border-r bg-card/50 min-h-screen">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-1">Staff & Admin</h2>
        <p className="text-sm text-muted-foreground">Management Portal</p>
      </div>

      <nav className="px-3 space-y-6">
        {navSections.map((section) => {
          // Filter out admin-only items if user is not elevated (admin or super_admin)
          const visibleItems = section.items.filter(
            (item) => !item.adminOnly || isElevated
          );

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.title}>
              <h3 className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="space-y-1">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  // For exact match routes (like /admin/accounting), only match exactly
                  // For other routes, also match child paths
                  const isExactMatchRoute = item.href === "/admin/accounting";
                  const isActive = isExactMatchRoute 
                    ? location === item.href 
                    : (location === item.href || location.startsWith(item.href + "/"));

                  return (
                    <Button
                      key={item.href}
                      variant={isActive ? "default" : "ghost"}
                      className="w-full justify-start gap-3"
                      data-testid={`staff-nav-${item.href.replace(/\//g, "-")}`}
                      asChild
                    >
                      <Link href={item.href}>
                        <Icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {item.adminOnly && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            Admin
                          </Badge>
                        )}
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
