import { useState } from "react";
import { StaffSidebar } from "./staff-sidebar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Menu, PanelLeftClose, PanelLeftOpen } from "lucide-react";

interface StaffLayoutProps {
  children: React.ReactNode;
}

const SIDEBAR_PREF_KEY = "staff-sidebar-collapsed";

export function StaffLayout({ children }: StaffLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Full-screen mode for the wall tablet / pack bench: hide the sidebar and let the
  // page (the orders board especially) take the whole width. Remembered per device.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(SIDEBAR_PREF_KEY) === "1"; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((v) => {
      try { localStorage.setItem(SIDEBAR_PREF_KEY, v ? "0" : "1"); } catch { /* private mode */ }
      return !v;
    });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        {/* Desktop Sidebar — the collapse toggle lives IN the flow (inside the sidebar,
            or on a slim rail when collapsed) so no header can cover it. */}
        {collapsed ? (
          <div className="hidden md:flex flex-col items-center border-r bg-card/30 px-1 pt-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleCollapsed}
              title="Show menu"
              aria-label="Show menu"
              data-testid="button-toggle-sidebar"
            >
              <PanelLeftOpen className="w-5 h-5" />
            </Button>
          </div>
        ) : (
          <div className="hidden md:block">
            <StaffSidebar
              headerAction={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleCollapsed}
                  className="text-muted-foreground -mr-2 -mt-1"
                  title="Hide menu (full screen)"
                  aria-label="Hide menu"
                  data-testid="button-toggle-sidebar"
                >
                  <PanelLeftClose className="w-5 h-5" />
                </Button>
              }
            />
          </div>
        )}

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
