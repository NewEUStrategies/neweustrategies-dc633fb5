// Molekuła: zakładka huba „w przygotowaniu" - co pokaże, kiedy (etap) i gdzie
// te dane są w panelu już dziś (I9a, 2026-10-20).
//
// DLACZEGO NIE JEDNO ZDANIE. Od I9a hub stoi w nawigacji panelu, więc admin
// trafia na zakładki, których treść dowiozą dopiero S7 i S5+S8. Zaślepka I0
// („Ta sekcja huba jest w przygotowaniu.") zostawiała go z pustym ekranem
// i bez następnego kroku. To zdanie zostaje pierwszą linią (kontrakt testów
// tras I0), a pod nim stoją: opis zawartości, etap i skoki do modułów, które
// dziś trzymają te dane - z tymi samymi parametrami deep linków co diagnozy
// (`AREA_OWNER_LINK`, SPEC §2.6).
//
// WYGLĄD Z ISTNIEJĄCYCH KLAS. Ramka jak `RevenueSection`, przyciski jak pasek
// „Powiązane moduły" (`RelatedModulesBar`: obrysowane, `h-7`) - arkusz CSS
// panelu ma zapas ułamka kilobajta, a ten sam wzorzec wygląda tak samo
// w trybie jasnym i ciemnym (kolory z tokenów motywu).
//
// `<dl>`: trzy pary „pytanie - odpowiedź" czytnik ekranu ogłasza jako listę
// definicji, a nie trzy luźne akapity. Nagłówek `h2` - pod `h1` huba.
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { TAB_PREPARING, TAB_STAGE_KEY, TAB_TITLE_KEY } from "@/lib/admin/revenue/tabPreparing";
import { ensureI18n as ensureRevenueI18n } from "@/lib/i18n-admin-revenue";
import { ensureI18n as ensurePreparingI18n } from "@/lib/i18n-admin-revenue-preparing";
import { ensureI18n as ensureShellI18n } from "@/lib/i18n-admin-revenue-shell";
import type { RevenueTabId } from "@/lib/revenue/search";

export interface RevenueTabPreparingProps {
  tab: RevenueTabId;
}

export function RevenueTabPreparing({ tab }: RevenueTabPreparingProps) {
  ensureRevenueI18n();
  ensureShellI18n();
  ensurePreparingI18n();
  const { t } = useTranslation();
  const headingId = useId();
  const spec = TAB_PREPARING[tab];
  // Zakładka z treścią nie ma już wpisu (od Integratora S8: Ścieżki) - stanu
  // „w przygotowaniu" nie ma, więc molekuła nie rysuje niczego.
  if (!spec) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-tab-state={spec.stage === "s6s7" ? "partial" : "preparing"}
      className="rounded-[6px] border border-border bg-card p-4 space-y-3"
    >
      <div className="min-w-0 space-y-0.5">
        <h2 id={headingId} className="text-base font-semibold">
          {t(TAB_TITLE_KEY[tab])}
        </h2>
        <p className="text-sm text-muted-foreground">
          {spec.stage === "s6s7"
            ? t("adminRevenue.preparing.partial")
            : t("adminRevenue.common.pending")}
        </p>
      </div>
      <dl className="space-y-3 text-sm">
        <div className="space-y-0.5">
          <dt className="font-medium">{t("adminRevenue.preparing.whatLabel")}</dt>
          <dd className="text-muted-foreground">{t(spec.whatKey)}</dd>
        </div>
        <div className="space-y-0.5">
          <dt className="font-medium">{t("adminRevenue.preparing.whenLabel")}</dt>
          <dd className="text-muted-foreground">{t(TAB_STAGE_KEY[spec.stage])}</dd>
        </div>
        <div className="space-y-1">
          <dt className="font-medium">{t("adminRevenue.preparing.todayLabel")}</dt>
          <dd>
            <ul className="flex flex-wrap items-center gap-2">
              {spec.links.map((link) => (
                <li key={link.labelKey}>
                  <Button asChild size="sm" variant="outline" className="h-7">
                    <Link to={link.to} search={link.search}>
                      {t(link.labelKey)}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </section>
  );
}
