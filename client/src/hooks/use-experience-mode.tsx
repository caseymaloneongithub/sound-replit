import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { useAuth } from "./use-auth";

type ExperienceMode = "admin" | "retail" | "wholesale";

interface ExperienceModeContextType {
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
  isSuperAdmin: boolean;
}

const ExperienceModeContext = createContext<ExperienceModeContextType | undefined>(undefined);

export function ExperienceModeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === "super_admin";
  
  const [mode, setModeState] = useState<ExperienceMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("experienceMode");
      if (saved === "retail" || saved === "wholesale" || saved === "admin") {
        return saved;
      }
    }
    return "admin";
  });

  const setMode = (newMode: ExperienceMode) => {
    setModeState(newMode);
    localStorage.setItem("experienceMode", newMode);
  };

  useEffect(() => {
    if (!isSuperAdmin) {
      localStorage.removeItem("experienceMode");
    }
  }, [isSuperAdmin]);

  return (
    <ExperienceModeContext.Provider value={{ mode, setMode, isSuperAdmin }}>
      {children}
    </ExperienceModeContext.Provider>
  );
}

export function useExperienceMode() {
  const context = useContext(ExperienceModeContext);
  if (context === undefined) {
    throw new Error("useExperienceMode must be used within an ExperienceModeProvider");
  }
  return context;
}
