// Organizm: ruchy MRR okresu według rodzaju, powodu i waluty (SPEC §2.2
// `mrr`, §6.1; karta S7).
//
// SKĄD LICZBY. Rodzaje ruchu (nowe, rozszerzenia, reaktywacje, zmniejszenia,
// odejścia, otwarcie księgi) pochodzą z mostu MRR - TEN SAM klucz co
// `MrrBridgeCard` obok (`bridgeSegmentKeyOf`), więc tabela nie pobiera mostu
// drugi raz i nie może pokazać innej kwoty niż wodospad. Rozbicie odejść na
// powody (rezygnacja, nieopłacona, wstrzymana, zmiana waluty) - z księgi
// odejść (`revenueChurnQueryOptions`), z liczbą ruchów.
//
// SEGMENT. Most przyjmuje segment, księga odejść - nie. Pod filtrem segmentu
// wiersze powodów liczyłyby wszystkie segmenty obok kwot jednego, więc ich
// nie pokazujemy i nie pobieramy - zdanie mówi, jak je zobaczyć.
//
// TABELA, NIE WYKRES. Waluty są KOLUMNAMI (`th scope="col"`), rodzaj i powód -
// nagłówkami wierszy, więc żadna komórka nie łączy dwóch walut, a czytnik
// odczytuje „Odejścia, Rezygnacja, PLN" bez zgadywania.
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { ChurnReasonRow } from "@/lib/revenue/finance/dto";
import {
  revenueChurnQueryOptions,
  revenueMrrBridgeQueryOptions,
} from "@/lib/revenue/finance/queries";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";
import { FinanceCardFrame, NoValue, NoValueFootnote } from "./FinanceCardFrame";
import { bridgeSegmentKeyOf, movementTable, type MovementRow } from "./mrrModel";

export interface MrrMovementsTableProps {
  tenantId: string | null;
  roles: readonly string[];
  range: RevenueRange;
  segment: RevenueSegment | null;
}

const KIND_KEY = {
  opening: "adminRevenue.finance.movementKind.opening",
  new: "adminRevenue.finance.movementKind.new",
  expansion: "adminRevenue.finance.movementKind.expansion",
  reactivation: "adminRevenue.finance.movementKind.reactivation",
  contraction: "adminRevenue.finance.movementKind.contraction",
  churn: "adminRevenue.finance.movementKind.churn",
} as const;

export function MrrMovementsTable({ tenantId, roles, range, segment }: MrrMovementsTableProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const isAdmin = roles.includes("admin");
  const segmentKey = bridgeSegmentKeyOf(segment);
  const bridge = useQuery(
    revenueMrrBridgeQueryOptions(tenantId, range, segmentKey, { roleOk: isAdmin }),
  );
  // Powody tylko bez filtra segmentu - inaczej mieszałyby dwie populacje.
  const churn = useQuery(
    revenueChurnQueryOptions(tenantId, range, { roleOk: isAdmin && segmentKey === null }),
  );
  const status = cardStatusOf(bridge, tenantId);

  let body = null;
  if (status === "ready" && bridge.data?.state === "ready") {
    const currencies = bridge.data.data.currencies ?? [];
    const reasons: ChurnReasonRow[] | null =
      segmentKey === null && churn.data?.state === "ready" ? churn.data.data.reasons : null;
    const table = movementTable(currencies, reasons);
    // Odmowa, brak funkcji albo błąd księgi odejść nie zasłania rodzajów
    // z mostu - mówimy tylko, że rozbicia na powody teraz nie ma.
    const reasonsMissing = (churn.data !== undefined && reasons === null) || churn.isError;
    const reasonsNote =
      segmentKey !== null
        ? t("adminRevenue.mrr.reasonsAllSegmentsOnly")
        : reasonsMissing
          ? t("adminRevenue.mrr.reasonsUnavailable")
          : null;
    const hasNone = table.rows.some((row) => [...row.amounts.values()].includes(null));
    body =
      table.currencies.length === 0 ? (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.mrr.movementsEmpty")}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="mrr-movements-table">
              <caption className="sr-only">{t("adminRevenue.mrr.movementsCaption")}</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.movementKindColumn")}
                  </th>
                  <th scope="col" className="py-1 pr-3 font-medium">
                    {t("adminRevenue.mrr.movementReasonColumn")}
                  </th>
                  {table.currencies.map((currency) => (
                    <th key={currency} scope="col" className="py-1 pr-3 text-right font-medium">
                      {currency}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {table.rows.map((row) => (
                  <MovementTableRow
                    key={`${row.kind}:${row.reason ?? "all"}`}
                    row={row}
                    currencies={table.currencies}
                    lang={lang}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {reasonsNote ? (
            <p className="m-0 text-xs text-muted-foreground" data-testid="mrr-movements-reasons">
              {reasonsNote}
            </p>
          ) : null}
          {hasNone ? (
            <NoValueFootnote
              label={t("adminRevenue.finance.noData")}
              hint={t("adminRevenue.finance.noDataHint")}
            />
          ) : null}
          {reasons?.some((r) => r.reason === "currency_switch") ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.finance.churn.currencySwitchHint")}
            </p>
          ) : null}
        </div>
      );
  }

  return (
    <FinanceCardFrame
      testId="mrr-movements"
      title={t("adminRevenue.mrr.movementsTitle")}
      isAdmin={isAdmin}
      status={status}
      onRetry={() => void bridge.refetch()}
    >
      {body}
    </FinanceCardFrame>
  );
}

function MovementTableRow({
  row,
  currencies,
  lang,
}: {
  row: MovementRow;
  currencies: readonly string[];
  lang: ChartLang;
}) {
  const { t } = useTranslation();
  const isReason = row.reason !== null;
  return (
    <tr data-kind={row.kind} data-reason={row.reason ?? "all"}>
      <th scope="row" className="py-1 pr-3 text-left font-normal">
        {isReason ? (
          // Wiersz powodu powtarza rodzaj dla czytnika; wzrokowo jest wcięty
          // pod wierszem „Odejścia".
          <span className="sr-only">{t(KIND_KEY[row.kind])}</span>
        ) : (
          t(KIND_KEY[row.kind])
        )}
      </th>
      <td className={isReason ? "py-1 pr-3 pl-3" : "py-1 pr-3 text-muted-foreground"}>
        {row.reason !== null ? (
          <>
            {t(`adminRevenue.finance.churn.reason.${row.reason}`)}
            {row.movements !== null ? (
              <span className="text-xs text-muted-foreground">
                {" · "}
                {t("adminRevenue.mrr.movementsCount", { count: row.movements })}
              </span>
            ) : null}
          </>
        ) : (
          t("adminRevenue.mrr.allReasons")
        )}
      </td>
      {currencies.map((currency) => {
        const amount = row.amounts.get(currency) ?? null;
        return (
          <td key={currency} className="py-1 pr-3 text-right tabular-nums">
            {amount === null ? (
              <NoValue label={t("adminRevenue.finance.noData")} />
            ) : (
              formatMoneyMinor(amount, currency, lang)
            )}
          </td>
        );
      })}
    </tr>
  );
}
