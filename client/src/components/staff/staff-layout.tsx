import { Navbar } from "@/components/layout/navbar";
import { StaffSidebar } from "./staff-sidebar";

interface StaffLayoutProps {
  children: React.ReactNode;
}

export function StaffLayout({ children }: StaffLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="flex">
        <StaffSidebar />
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
