// Organizm: treść zakładki Dostęp (SPEC §2.2 `access`, karta S7) - polityka
// w jednym zdaniu, ślepe zaułki, lista kontrolna paywalla, pomiar, symulator
// czytelnika, licznik darmowych artykułów (karta S1) i inwentarz reguł.
//
// DANE Z PRODUCENTÓW, BEZ KOPII. Inwentarz - `revenueAccessInventoryQueryOptions`
// (S3), ustawienia licznika - `meteringSettingsQueryOptions` (S1, ten sam
// wpis cache co karta licznika obok i strona artykułu), lista kontrolna -
// fakty S7-A. Karta licznika to ORGANIZM MODUŁU (`MeteringSettingsCard`):
// hub nie ma drugiego formularza licznika, a redaktor dostaje go w trybie
// `readOnly` (pola i zapis wyłączone z powodem).
//
// ODCZYT LICZNIKA, KTÓRY SIĘ NIE UDAŁ, TO „NIE WIADOMO", nie „wyłączony" -
// `undefined` trafia do zdania polityki jako osobny stan.
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { MeteringSettingsCard } from "@/components/admin/paywall/MeteringSettingsCard";
import { RevenueSection } from "@/components/admin/revenue/molecules/RevenueSection";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { meteringSettingsQueryOptions } from "@/lib/access/meteringQueries";
import { accessPolicyFacts } from "@/lib/admin/revenue/policySentence";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { AccessInventoryDeadEnds } from "@/lib/revenue/access/dto";
import { revenueAccessInventoryQueryOptions } from "@/lib/revenue/access/queries";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { AccessInventoryTable } from "./AccessInventoryTable";
import { PaywallChecklistCard } from "./PaywallChecklistCard";
import { PaywallMeasurementCard } from "./PaywallMeasurementCard";
import { PolicySentence } from "./PolicySentence";
import { ReaderPreview } from "./ReaderPreview";

const DEAD_END_KEYS: Readonly<
  Record<keyof AccessInventoryDeadEnds, { label: string; hint: string }>
> = {
  tierWithoutOffer: {
    label: "adminRevenue.access.deadEnds.tierWithoutOffer.label",
    hint: "adminRevenue.access.deadEnds.tierWithoutOffer.hint",
  },
  paidWithoutOffer: {
    label: "adminRevenue.access.deadEnds.paidWithoutOffer.label",
    hint: "adminRevenue.access.deadEnds.paidWithoutOffer.hint",
  },
  danglingPlans: {
    label: "adminRevenue.access.deadEnds.danglingPlans.label",
    hint: "adminRevenue.access.deadEnds.danglingPlans.hint",
  },
  meteredTierGated: {
    label: "adminRevenue.access.deadEnds.meteredTierGated.label",
    hint: "adminRevenue.access.deadEnds.meteredTierGated.hint",
  },
};

export interface RevenueAccessViewProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
  segment: RevenueSegment | null;
}

export function RevenueAccessView({ tenantId, roles, range, segment }: RevenueAccessViewProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t } = useTranslation();
  const deadEndsId = useId();
  const inventoryQ = useQuery(revenueAccessInventoryQueryOptions(tenantId));
  const meteringQ = useQuery({ ...meteringSettingsQueryOptions(), enabled: Boolean(tenantId) });
  const status = cardStatusOf(inventoryQ, tenantId);
  const isAdmin = roles.includes("admin");
  const inventory = inventoryQ.data?.state === "ready" ? inventoryQ.data.inventory : null;
  // `undefined` = odczyt trwa albo się nie udał; `null` = brak wiersza w bazie.
  const metering = meteringQ.isError || meteringQ.data === undefined ? undefined : meteringQ.data;

  const stateCard =
    status === "ready" ? null : (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.access.state.forbidden"
        unavailableKey="adminRevenue.access.state.unavailable"
        onRetry={() => void inventoryQ.refetch()}
      />
    );

  return (
    <div className="space-y-6" data-testid="revenue-access-view">
      <RevenueSection
        titleKey="adminRevenue.accessTab.policy.title"
        descriptionKey="adminRevenue.access.subtitle"
      >
        {inventory ? (
          <div className="space-y-3">
            <PolicySentence facts={accessPolicyFacts(inventory, metering)} />
            <section aria-labelledby={deadEndsId} className="space-y-1">
              <h3 id={deadEndsId} className="text-sm font-semibold">
                {t("adminRevenue.access.deadEnds.title")}
              </h3>
              <dl className="m-0 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {(Object.keys(DEAD_END_KEYS) as (keyof AccessInventoryDeadEnds)[]).map((key) => (
                  <div key={key} className="contents" data-dead-end={key}>
                    <dt className="font-medium">
                      {t(DEAD_END_KEYS[key].label)}:{" "}
                      <span className="tabular-nums">{inventory.deadEnds[key]}</span>
                    </dt>
                    <dd className="m-0 text-xs text-muted-foreground">
                      {t(DEAD_END_KEYS[key].hint)}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        ) : (
          stateCard
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          <PaywallChecklistCard tenantId={tenantId} roles={roles} />
          {inventory ? (
            <PaywallMeasurementCard
              tenantId={tenantId}
              inventory={inventory}
              range={range}
              segment={segment}
            />
          ) : null}
        </div>
      </RevenueSection>

      {inventory ? <ReaderPreview inventory={inventory} /> : null}

      {/* Bez najemcy karta modułu nie ma czego czytać - i nie wysyła zapytania. */}
      {tenantId ? <MeteringSettingsCard readOnly={!isAdmin} /> : null}

      <RevenueSection titleKey="adminRevenue.access.title">
        {inventory ? (
          inventory.rows.length > 0 ? (
            <AccessInventoryTable inventory={inventory} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground">
              {t("adminRevenue.accessTab.policy.noRules")}
            </p>
          )
        ) : (
          stateCard
        )}
      </RevenueSection>
    </div>
  );
}
