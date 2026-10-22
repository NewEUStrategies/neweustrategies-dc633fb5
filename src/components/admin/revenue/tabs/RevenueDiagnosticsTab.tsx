// Zakładka „Diagnostyka" huba (S7, SPEC §2.2 `diagnostics`) - tablica
// `DiagnosticsBoard` z parametrami adresu `?area=`, `?view=`, `?finding=`
// i `?fix=` (kontrakt §2.6, walidator `parseRevenueHubSearch` układu).
//
// Montuje ją leniwie `RevenueTabOutlet` (mapa `tab -> lazy`), więc kod
// diagnostyki - 55 reguł, słownik i dialogi napraw - trafia do własnego
// chunku dopiero po wejściu na `/admin/revenue/diagnostics` (budżet bundla
// wejściowego zamrożony).
//
// `useHydrated()` PRZED SESJĄ. Serwer nie zna sesji tak jak klient, więc do
// hydratacji obie strony rysują ten sam stan „wczytywanie" (jak układ huba);
// rola i najemca są czytane dopiero po hydratacji.
//
// ROLE DOKŁADNE (`roles.includes`), NIE `isAdmin`: `isAdmin` liczy też
// `super_admin`, a funkcja `admin_revenue_facts()` pyta o wiersz `admin`
// albo `editor` - sam `super_admin` dostałby odmowę `42501`. Układ huba
// i tak nie pokaże zakładki autorowi; bramka tutaj chroni przed wejściem
// z adresu i przed rozjazdem, gdyby układ się zmienił.
import { useHydrated, useNavigate, useSearch } from "@tanstack/react-router";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import {
  DiagnosticsBoard,
  type DiagnosticsSearch,
} from "@/components/admin/revenue/diagnostics/DiagnosticsBoard";
import { RoleGateNotice } from "@/components/admin/revenue/molecules/RoleGateNotice";
import { hubRoleOf } from "@/components/admin/revenue/overview/hubWindow";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue-diagnostics";

export function RevenueDiagnosticsTab() {
  ensureI18n();
  const hydrated = useHydrated();
  return (
    <div data-testid="revenue-tab-diagnostics">
      {hydrated ? <DiagnosticsTabBody /> : <RevenueTabPending />}
    </div>
  );
}

function DiagnosticsTabBody() {
  const { roles, tenantId } = useAuth();
  const search = useSearch({ from: "/admin/revenue" });
  const navigate = useNavigate();
  if (hubRoleOf(roles) === null) return <RoleGateNotice requiredRole="admin_or_editor" />;

  const boardSearch: DiagnosticsSearch = {
    area: search.area,
    view: search.view,
    finding: search.finding,
    fix: search.fix,
  };

  return (
    <DiagnosticsBoard
      tenantId={tenantId ?? null}
      roles={roles}
      search={boardSearch}
      onSearchChange={(patch) => {
        // Zmiana filtra, widoku albo dialogu to NOWY wpis historii: „Wstecz"
        // w przeglądarce zamyka dialog naprawy i wraca do poprzedniego filtra.
        void navigate({ to: ".", search: (prev) => ({ ...prev, ...patch }) });
      }}
    />
  );
}
