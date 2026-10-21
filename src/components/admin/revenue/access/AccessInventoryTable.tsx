// Organizm: inwentarz reguł dostępu - rodzaj treści × tryb × próg warstwy ×
// licznik (SPEC §2.2 `access`, §6.1, §6.8).
//
// TABELA DOSTĘPNA. `caption` nazywa tabelę, nagłówki mają `scope`, a region
// przewijany w poziomie jest fokusowalny (`tabIndex=0`) i nazwany - na
// wąskim ekranie klawiatura przewija tabelę, zamiast gubić kolumny (WCAG
// 2.1.1, 1.3.1). Strona nie dostaje poziomego paska - przewija się tylko
// region tabeli.
//
// NAPISY Z SŁOWNIKA S3 (`adminRevenue.access.*`): rodzaj, tryb, polityka
// licznika i próg - te same zdania co w podpowiedziach inwentarza.
import { useTranslation } from "react-i18next";

import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFunnelI18n } from "@/lib/i18n-admin-revenue-funnel";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { AccessInventoryDto } from "@/lib/revenue/access/dto";
import { ACCESS_ENTITY_KEY, ACCESS_MODE_KEY, ACCESS_POLICY_KEY } from "./accessKeys";

const LOCALE: Readonly<Record<ChartLang, string>> = { pl: "pl-PL", en: "en-GB" };

export interface AccessInventoryTableProps {
  inventory: AccessInventoryDto;
}

export function AccessInventoryTable({ inventory }: AccessInventoryTableProps) {
  ensureFunnelI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(LOCALE[chartLangFrom(i18n.language)]);

  return (
    <div
      role="region"
      tabIndex={0}
      aria-label={t("adminRevenue.accessTab.inventory.region")}
      data-testid="access-inventory"
      className="overflow-x-auto rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <table className="w-full min-w-[32rem] text-sm">
        <caption className="pb-2 text-left text-xs text-muted-foreground">
          {t("adminRevenue.accessTab.inventory.caption")}
        </caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.access.columns.entity")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.access.columns.mode")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.access.columns.minTierRank")}
            </th>
            <th scope="col" className="py-1 pr-3 font-medium">
              {t("adminRevenue.access.columns.policy")}
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              {t("adminRevenue.access.columns.count")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {inventory.rows.map((row) => (
            <tr
              key={`${row.entityType}:${row.mode}:${row.minTierRank}:${row.meteringPolicy}`}
              data-mode={row.mode}
            >
              <th scope="row" className="py-1 pr-3 text-left font-normal">
                {t(ACCESS_ENTITY_KEY[row.entityType])}
              </th>
              <td className="py-1 pr-3">{t(ACCESS_MODE_KEY[row.mode])}</td>
              <td className="py-1 pr-3">
                {row.minTierRank > 0
                  ? t("adminRevenue.access.rankThreshold", { rank: row.minTierRank })
                  : t("adminRevenue.access.noThreshold")}
              </td>
              <td className="py-1 pr-3">{t(ACCESS_POLICY_KEY[row.meteringPolicy])}</td>
              <td className="py-1 text-right tabular-nums">{number.format(row.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
