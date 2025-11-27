import { useExperienceMode } from "@/hooks/use-experience-mode";
import { useLocation } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Shield, ShoppingBag, Building2 } from "lucide-react";

export function ExperienceSwitcher() {
  const { mode, setMode, isSuperAdmin } = useExperienceMode();
  const [, setLocation] = useLocation();

  if (!isSuperAdmin) {
    return null;
  }

  const handleModeChange = (newMode: string) => {
    setMode(newMode as "admin" | "retail" | "wholesale");
    
    switch (newMode) {
      case "admin":
        setLocation("/staff-portal/wholesale/orders");
        break;
      case "retail":
        setLocation("/shop");
        break;
      case "wholesale":
        setLocation("/wholesale-customer/place-order");
        break;
    }
  };

  const modeLabels = {
    admin: { label: "Admin View", icon: Shield },
    retail: { label: "Retail Customer", icon: ShoppingBag },
    wholesale: { label: "Wholesale Customer", icon: Building2 },
  };

  const CurrentIcon = modeLabels[mode].icon;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="bg-card border rounded-lg shadow-lg p-2">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-2">
            <Shield className="h-3 w-3" />
            <span className="hidden sm:inline">Super Admin</span>
          </div>
          <Select value={mode} onValueChange={handleModeChange}>
            <SelectTrigger className="w-[180px]" data-testid="select-experience-mode">
              <div className="flex items-center gap-2">
                <CurrentIcon className="h-4 w-4" />
                <SelectValue />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Admin View
                </div>
              </SelectItem>
              <SelectItem value="retail">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="h-4 w-4" />
                  Retail Customer
                </div>
              </SelectItem>
              <SelectItem value="wholesale">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Wholesale Customer
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
