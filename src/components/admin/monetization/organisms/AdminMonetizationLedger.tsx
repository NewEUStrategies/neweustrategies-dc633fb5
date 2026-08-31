// Organizm: cały panel monetyzacji - filtr środowiska, kafelki podsumowania
// i trzy sekcje rejestru. Zapytanie mieszka TUTAJ, tabele są prezentacyjne.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { listMonetizationLedger } from "@/lib/admin/monetization/ledger.functions";
import {
  MONETIZATION_SECTIONS,
  type EnvironmentFilter,
  type MonetizationSection,
} from "@/lib/admin/monetization/model";
import { Button } from "@/components/ui/button";
import { EnvironmentFilterTabs } from "../molecules/EnvironmentFilterTabs";
import { LedgerSummaryCards } from "../molecules/LedgerSummaryCards";
import { DonationsLedgerTable } from "../molecules/DonationsLedgerTable";
import { GrantsLedgerTable } from "../molecules/GrantsLedgerTable";
import { GiftLinksLedgerTable } from "../molecules/GiftLinksLedgerTable";

export function AdminMonetizationLedger() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language?.startsWith("en") ? "en" : "pl";
  const [environment, setEnvironment] = useState<EnvironmentFilter>("all");
  const [section, setSection] = useState<MonetizationSection>("donations");
  const now = new Date();

  const ledger = useQuery({
    queryKey: ["admin", "monetization", "ledger", environment] as const,
    queryFn: () => listMonetizationLedger({ data: { environment, limit: 50 } }),
    staleTime: 30_000,
  });

  return (
    <div>
      <h2 className="font-display text-xl">{t("adminMonetization.title", { lng: lang })}</h2>
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        {t("adminMonetization.intro", { lng: lang })}
      </p>

      <div className="mb-5">
        <EnvironmentFilterTabs value={environment} onChange={setEnvironment} />
      </div>

      {ledger.isPending ? (
        <p className="text-sm text-muted-foreground">
          {t("adminMonetization.loading", { lng: lang })}
        </p>
      ) : ledger.isError || !ledger.data ? (
        <div className="flex items-center gap-3">
          <p className="text-sm text-destructive">{t("adminMonetization.error", { lng: lang })}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void ledger.refetch()}>
            {t("adminMonetization.retry", { lng: lang })}
          </Button>
        </div>
      ) : (
        <>
          {!ledger.data.tenantResolved && (
            <p className="mb-4 rounded-[6px] border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700">
              {t("adminMonetization.tenantMissing", { lng: lang })}
            </p>
          )}
          <LedgerSummaryCards summary={ledger.data.summary} lang={lang} />
          <div role="tablist" className="mb-3 inline-flex rounded-[6px] border border-border p-0.5">
            {MONETIZATION_SECTIONS.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={section === option}
                onClick={() => setSection(option)}
                className={`h-8 rounded-[6px] px-3 text-sm font-medium transition-colors ${
                  section === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t(`adminMonetization.sections.${option}`, { lng: lang })}
              </button>
            ))}
          </div>
          {section === "donations" && (
            <DonationsLedgerTable rows={ledger.data.donations} lang={lang} />
          )}
          {section === "grants" && (
            <GrantsLedgerTable
              rows={ledger.data.grants}
              donations={ledger.data.donations}
              lang={lang}
              now={now}
            />
          )}
          {section === "giftLinks" && (
            <GiftLinksLedgerTable rows={ledger.data.giftLinks} lang={lang} now={now} />
          )}
        </>
      )}
    </div>
  );
}
