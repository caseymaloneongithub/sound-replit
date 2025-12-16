import { useState } from "react";
import { StaffSidebar } from "./staff-sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu } from "lucide-react";

interface StaffLayoutProps {
  children: React.ReactNode;
}

export function StaffLayout({ children }: StaffLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Desktop Sidebar */}
        <div className="hidden md:block">
          <StaffSidebar />
        </div>

        {/* Mobile Header & Menu */}
        <div className="flex-1 flex flex-col">
          <header className="md:hidden flex items-center gap-2 p-4 border-b bg-card/50">
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="p-0 w-72">
                <StaffSidebar onLinkClick={() => setMobileMenuOpen(false)} />
              </SheetContent>
            </Sheet>
            <span className="font-semibold">Staff Portal</span>
          </header>

          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
