// Trasa /admin/paywall - wyłącznie kontrakt adresu, nagłówek strony i kompozycja.
//
// Plik miał 1149 linii: katalog planów z edytorem, licznik artykułów, wyjątki
// i kasę w jednym module, z własnymi literałami kluczy i zapisem pełnym
// wierszem. Organizmy żyją teraz w `components/admin/paywall/*` (reużywa ich
// hub „Przychód i lejek" - PLAN S1 §4.7), a trasa robi trzy rzeczy:
//   * ADRES = STAN. `?tab=plans|metering|overrides|checkout` wybiera zakładkę,
//     `?plan=<uuid>` otwiera edytor planu (SPEC §2.6) - link z huba i odświeżenie
//     strony lądują dokładnie tam, gdzie admin był. Walidator to liść bez
//     importów (`paywallTabs.ts`), bo powłoka trasy jedzie w chunku wejściowym.
//   * NAGŁÓWEK SEKCYJNY (`adminPageHead`, AGENTS.md) zamiast ogólnego tytułu.
//   * BEZ DRUGIEGO `AdminShell`. Layout `/admin` już go renderuje; dawna owijka
//     dawała podwójny `<main id="main-content">` i drugi pasek języka.
//   * SYGNAŁ HUBA (I9, SPEC §2.7): pasek Diagnostyki obszarów paywalla pod
//     kaflami - lekkie opakowanie, treść w leniwym chunku i tylko dla roli huba.
//
// Słownik rejestruje komponent (`ensureI18n` z importu nazwanego - bramka
// `adminRouteDictionaryImports`): import efektem ubocznym zostałby w powłoce.
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreditCard, Gauge, Layers, SlidersHorizontal } from "lucide-react";

import { AccessPlanEditorDialog } from "@/components/admin/paywall/AccessPlanEditorDialog";
import { CheckoutSettingsCard } from "@/components/admin/paywall/CheckoutSettingsCard";
import { MeteringOverridesCard } from "@/components/admin/paywall/MeteringOverridesCard";
import { MeteringSettingsCard } from "@/components/admin/paywall/MeteringSettingsCard";
import { PaywallKpiStrip } from "@/components/admin/paywall/PaywallKpiStrip";
import { PaywallPlansSection } from "@/components/admin/paywall/PaywallPlansSection";
import { RevenueSignalChip } from "@/components/admin/revenue/molecules/RevenueSignalChip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminPageHead } from "@/lib/adminPageHead";
import { isPaywallTab, parsePaywallSearch, type PaywallTabId } from "@/lib/admin/paywallTabs";
import { ensureI18n as ensurePaywallI18n } from "@/lib/i18n-admin-paywall-sync";

export const Route = createFileRoute("/admin/paywall")({
  validateSearch: parsePaywallSearch,
  head: () =>
    adminPageHead(
      "Paywall i plany",
      "Plany subskrypcji i ich sprzedaż, darmowy licznik artykułów, wyjątki dla pojedynczych treści oraz ustawienia kasy.",
    ),
  component: PaywallAdminPage,
});

const TAB_TRIGGER =
  "h-10 gap-2 whitespace-nowrap rounded-[6px] px-3 text-xs font-medium text-muted-foreground transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm hover:bg-muted/60 hover:text-foreground sm:h-8";

const TAB_ICONS = {
  plans: Layers,
  metering: Gauge,
  overrides: SlidersHorizontal,
  checkout: CreditCard,
} as const satisfies Record<PaywallTabId, unknown>;

function PaywallAdminPage() {
  ensurePaywallI18n();
  const { t } = useTranslation();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab: PaywallTabId = search.tab ?? "plans";
  // Nowy plan nie ma identyfikatora, więc nie ma adresu - żyje w stanie
  // strony. Istniejący plan jest w `?plan=` (link z huba, odświeżenie).
  const [creating, setCreating] = useState(false);
  const planId = search.plan ?? null;

  const setTab = (next: string) => {
    if (!isPaywallTab(next)) return;
    void navigate({ search: (s) => ({ ...s, tab: next }), replace: true });
  };
  const openPlan = (id: string | null) => {
    setCreating(id === null);
    void navigate({ search: (s) => ({ ...s, plan: id ?? undefined }), replace: true });
  };
  const closeEditor = (open: boolean) => {
    if (open) return;
    setCreating(false);
    void navigate({ search: (s) => ({ ...s, plan: undefined }), replace: true });
  };

  return (
    <div className="space-y-6">
      <header className="space-y-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{t("adminPaywall.page.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {t("adminPaywall.page.subtitle")}
          </p>
        </div>
        <PaywallKpiStrip />
        <RevenueSignalChip surface="paywall" variant="bar" />
      </header>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 gap-2 rounded-[6px] border border-border/60 bg-muted/50 p-1.5 shadow-sm sm:inline-flex sm:h-11 sm:w-auto sm:grid-cols-none sm:gap-1">
          {(Object.keys(TAB_ICONS) as PaywallTabId[]).map((id) => {
            const Icon = TAB_ICONS[id];
            return (
              <TabsTrigger key={id} value={id} className={TAB_TRIGGER}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{t(`adminPaywall.tabs.${id}`)}</span>
              </TabsTrigger>
            );
          })}
        </TabsList>
        <TabsContent value="plans" className="mt-4">
          <PaywallPlansSection onEdit={openPlan} />
        </TabsContent>
        <TabsContent value="metering" className="mt-4">
          <MeteringSettingsCard />
        </TabsContent>
        <TabsContent value="overrides" className="mt-4">
          <MeteringOverridesCard />
        </TabsContent>
        <TabsContent value="checkout" className="mt-4">
          <CheckoutSettingsCard />
        </TabsContent>
      </Tabs>

      <AccessPlanEditorDialog
        planId={creating ? null : planId}
        open={creating || planId !== null}
        onOpenChange={closeEditor}
      />
    </div>
  );
}
