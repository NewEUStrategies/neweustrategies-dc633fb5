// Lightweight context so panels (e.g. ThemeOptionsPane) can publish a
// secondary nav into the global admin left sidebar.
import { createContext, useContext, useState, type ReactNode, type ComponentType } from "react";

interface ExtraNavItem {
  id: string;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export interface ExtraNav {
  title?: string;
  items: ExtraNavItem[];
  activeId?: string;
  onSelect: (id: string) => void;
}

interface Ctx {
  extras: ExtraNav | null;
  setExtras: (e: ExtraNav | null) => void;
}

const AdminSidebarExtrasCtx = createContext<Ctx>({ extras: null, setExtras: () => {} });

export function AdminSidebarExtrasProvider({ children }: { children: ReactNode }) {
  const [extras, setExtras] = useState<ExtraNav | null>(null);
  return (
    <AdminSidebarExtrasCtx.Provider value={{ extras, setExtras }}>
      {children}
    </AdminSidebarExtrasCtx.Provider>
  );
}

export function useAdminSidebarExtrasSlot() {
  return useContext(AdminSidebarExtrasCtx);
}
