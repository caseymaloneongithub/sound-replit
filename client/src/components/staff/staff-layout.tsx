import { StaffSidebar } from "./staff-sidebar";

interface StaffLayoutProps {
  children: React.ReactNode;
}

export function StaffLayout({ children }: StaffLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex">
        <StaffSidebar />
        <main className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
