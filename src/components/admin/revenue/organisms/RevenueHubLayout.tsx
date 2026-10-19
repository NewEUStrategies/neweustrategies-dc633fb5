// Układ huba „Przychód i lejek" (`/admin/revenue`) - ZAŚLEPKA wycinka I0.
// Właściciel po scaleniu: S6 (pasek zakładek, filtry okresu i segmentu,
// `RoleGateNotice`, `MfaRequiredNotice`).
//
// DLACZEGO ROLA JEST SPRAWDZANA TUTAJ, A NIE W TRASIE. Layout `/admin`
// przepuszcza cały personel (`isStaff` = admin, editor, author), a hub jest
// dla admina i redaktora (SPEC §2.5). Warunek w pliku trasy jechałby
// w chunku wejściowym i rozjeżdżał się z bazą przy pierwszej zmianie ról -
// bramka `adminRouteAuthority.gate.test.ts` pilnuje, że trasy huba go nie
// mają. Autorytetem i tak jest baza: polityki tabel huba i RPC pytają
// o `has_role(…, 'admin')` albo `is_admin_or_editor()` (pgTAP
// `hub_schema_rls_test.sql`), a ta bramka tylko nie proponuje autorowi
// ekranu, który baza i tak zostawi pusty.
//
// DLACZEGO `roles.includes("admin")`, A NIE `isAdmin`. `isAdmin` z `useAuth`
// liczy też `super_admin`, a polityki huba pytają o DOKŁADNĄ rolę (`has_role`
// admin, `is_admin_or_editor()`). Sam `super_admin` (po `change_user_role` to
// jedyny wiersz) dostałby hub, w którym baza bez błędu zwraca zero wierszy -
// pusty lejek i 0 MRR wyglądałyby jak prawdziwy brak przychodu. Ten sam
// wzorzec co `AdminBiStrip`; pgTAP `hub_schema_rls_test` przypina stronę SQL.
//
// DLACZEGO `useHydrated()`. Serwer nie zna sesji tak jak klient, a treść
// huba zależy od roli. Do hydratacji obie strony renderują ten sam stan
// „wczytywanie", więc znacznik z serwera i pierwszy render klienta są
// identyczne (SPEC §2.1: brak różnic SSR/klient).
import { Outlet, useHydrated } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { RevenueTabPending } from "@/components/admin/revenue/atoms/RevenueTabPending";
import { useAuth } from "@/hooks/useAuth";
import { ensureI18n } from "@/lib/i18n-admin-revenue";

export function RevenueHubLayout() {
  ensureI18n();
  const { t } = useTranslation();
  const hydrated = useHydrated();
  const { roles } = useAuth();

  if (!hydrated) return <RevenueTabPending />;

  // UI = bramka SQL (SPEC §2.5): wiersz `admin` albo `editor` w najemcy.
  const canSeeHub = roles.includes("admin") || roles.includes("editor");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{t("adminRevenue.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("adminRevenue.subtitle")}</p>
      </header>
      {canSeeHub ? (
        <Outlet />
      ) : (
        // Nagłówek zostaje, żeby autor wiedział, GDZIE jest; znika wyłącznie
        // treść zakładki. S6 podmienia ten akapit na wspólny `RoleGateNotice`.
        <p role="status" data-testid="revenue-role-gate" className="text-sm text-muted-foreground">
          {t("adminRevenue.common.roleGate")}
        </p>
      )}
    </div>
  );
}
