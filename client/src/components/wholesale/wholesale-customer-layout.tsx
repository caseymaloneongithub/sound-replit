import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ShoppingCart, FileText, LogOut, Building2, Mail, Phone } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { WholesaleCustomer } from "@shared/schema";

interface WholesaleCustomerLayoutProps {
  children: React.ReactNode;
}

export function WholesaleCustomerLayout({ children }: WholesaleCustomerLayoutProps) {
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();
  
  const { data: customer } = useQuery<WholesaleCustomer>({
    queryKey: ["/api/wholesale-customer"],
  });

  const handleLogout = async () => {
    try {
      await apiRequest("POST", "/api/logout");
      queryClient.setQueryData(["/api/user"], null);
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      toast({
        title: "Logged out",
        description: "You have been successfully logged out",
      });
      setLocation("/wholesale/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const navItems = [
    {
      label: "Place Order",
      href: "/wholesale-customer/place-order",
      icon: ShoppingCart,
    },
    {
      label: "Order History",
      href: "/wholesale-customer/orders",
      icon: FileText,
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link href="/wholesale-customer/place-order" className="flex items-center gap-2">
                <Building2 className="h-6 w-6 text-primary" />
                <span className="font-semibold text-lg hidden sm:inline">Wholesale Portal</span>
              </Link>
              <nav className="flex items-center gap-1">
                {navItems.map((item) => {
                  const isActive = location === item.href;
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        size="sm"
                        className="gap-2"
                        data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
                      >
                        <item.icon className="h-4 w-4" />
                        <span className="hidden sm:inline">{item.label}</span>
                      </Button>
                    </Link>
                  );
                })}
              </nav>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="gap-2"
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        </div>
      </header>
      {customer && (
        <div className="border-b bg-muted/30">
          <div className="container mx-auto px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <div>
                <h2 className="font-semibold text-lg" data-testid="text-business-name">
                  {customer.businessName}
                </h2>
                <p className="text-sm text-muted-foreground" data-testid="text-contact-name">
                  {customer.contactName}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  <span data-testid="text-customer-email">{customer.email}</span>
                </div>
                {customer.phone && (
                  <div className="flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5" />
                    <span data-testid="text-customer-phone">{customer.phone}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <main>
        {children}
      </main>
    </div>
  );
}
