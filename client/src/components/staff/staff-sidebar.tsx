import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  FileText,
  TruckIcon,
  ClipboardList,
  Settings,
  BarChart3,
  Home
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

  const navSections: NavSection[] = [
    {
      title: "Overview",
      items: [
        { title: "Staff Portal", href: "/staff-portal", icon: LayoutDashboard },
      ],
    },
    {
      title: "Wholesale",
      items: [
        { title: "Dashboard", href: "/wholesale", icon: Home },
        { title: "Place Order", href: "/wholesale/place-order", icon: ShoppingCart },
        { title: "Orders", href: "/wholesale/orders", icon: FileText },
        { title: "Customers", href: "/wholesale/customers", icon: Users },
        { title: "Products", href: "/wholesale/products", icon: Package },
        { title: "Delivery Report", href: "/wholesale/delivery-report", icon: TruckIcon },
      ],
    },
    {
      title: "Inventory & Reports",
      items: [
        { title: "Inventory", href: "/inventory", icon: ClipboardList },
        { title: "Reports", href: "/reports", icon: BarChart3 },
      ],
    },
    {
      title: "Administration",
      items: [
        { title: "Product Management", href: "/admin/products", icon: Settings, adminOnly: true },
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
          // Filter out admin-only items if user is not admin
          const visibleItems = section.items.filter(
            (item) => !item.adminOnly || user?.isAdmin
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
                  const isActive = location === item.href || location.startsWith(item.href + "/");

                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={isActive ? "default" : "ghost"}
                        className="w-full justify-start gap-3"
                        data-testid={`staff-nav-${item.href.replace(/\//g, "-")}`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{item.title}</span>
                        {item.adminOnly && (
                          <Badge variant="secondary" className="ml-auto text-xs">
                            Admin
                          </Badge>
                        )}
                      </Button>
                    </Link>
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
