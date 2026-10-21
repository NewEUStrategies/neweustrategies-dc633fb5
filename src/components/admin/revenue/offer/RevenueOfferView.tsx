// Organizm: treść zakładki Oferta (SPEC §2.2 `offer`, karta S7) - drabina
// cen, macierz plan × benefit z konfliktami P20, rabaty i kupony
// (`?sec=discounts`) i kasa w jednym zdaniu.
//
// REDAKTOR W TRYBIE PODGLĄDU (SPEC §2.5, `HUB_TABS.offer.editorMode`).
// Widzi całą ofertę, ale każdy przycisk zapisu jest wyłączony z powodem
// (`DisabledReason` + `Tooltip`) - a notka nad sekcją mówi to raz, zanim
// ktoś zacznie szukać, dlaczego przycisk nie działa.
//
// Edycja idzie przez organizmy i mutatory modułów (`AccessPlanEditorDialog`,
// `useSaveAccessPlanPatch`), z nagłówkiem źródła prawdy (`SourceHeader`) -
// hub nie ma własnej kopii formularza planu.
import { useTranslation } from "react-i18next";

import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import { CheckoutSentenceCard } from "./CheckoutSentenceCard";
import { DiscountsCard } from "./DiscountsCard";
import { PlanBenefitMatrix } from "./PlanBenefitMatrix";
import { PriceLadder } from "./PriceLadder";

export interface RevenueOfferViewProps {
  tenantId: string | null;
  roles: readonly string[];
  /** `?sec=` z adresu - `discounts` przewija do rabatów. */
  section: string | undefined;
}

export function RevenueOfferView({ tenantId, roles, section }: RevenueOfferViewProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t } = useTranslation();
  const isAdmin = roles.includes("admin");

  return (
    <div className="space-y-6" data-testid="revenue-offer-view">
      <RevenueSection titleKey="adminRevenue.finance.offer.title">
        {isAdmin ? null : (
          <p className="m-0 text-xs text-muted-foreground" data-testid="offer-editor-preview">
            {t("adminRevenue.role.editorPreview")}
          </p>
        )}
        <PriceLadder tenantId={tenantId} />
        <PlanBenefitMatrix tenantId={tenantId} roles={roles} />
      </RevenueSection>
      <RevenueSection titleKey="adminRevenue.offer.salesTitle">
        <div className="grid gap-4 lg:grid-cols-2">
          <DiscountsCard focused={section === "discounts"} />
          <CheckoutSentenceCard tenantId={tenantId} roles={roles} />
        </div>
      </RevenueSection>
    </div>
  );
}
