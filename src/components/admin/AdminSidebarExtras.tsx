// Lightweight context so panels (e.g. ThemeOptionsPane) can publish a
// secondary nav into the global admin left sidebar.
import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
  type ComponentType,
} from "react";

export interface ExtraNavItem {
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

/** Register a secondary nav into the global admin sidebar for the lifetime of the caller. */
export function useRegisterAdminSidebarExtras(nav: ExtraNav | null) {
  const { setExtras } = useContext(AdminSidebarExtrasCtx);
  useEffect(() => {
    setExtras(nav);
    return () => setExtras(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav?.title, nav?.activeId, JSON.stringify(nav?.items?.map((i) => i.id))]);
}
