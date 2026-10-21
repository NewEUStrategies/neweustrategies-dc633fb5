// Organizm: most MRR - początek okresu, ruchy w okresie i koniec, osobno
// dla każdej waluty (SPEC §2.2 `overview`/`mrr`, §6.1, §6.2; karta S7).
//
// JEDEN ORGANIZM, DWA WARIANTY, JEDEN KLUCZ. Kokpit montuje `compact` (jedna
// linia na walutę), zakładka Przychód (S7-C) - `full` (wodospad `ChartCard`
// + `biChart`). Oba wołają `revenueMrrBridgeQueryOptions` z tymi samymi
// argumentami (segment `all` = `null`), więc przejście Kokpit → Przychód nie
// pobiera mostu drugi raz, a obie liczby nie mogą się rozjechać.
//
// SUMA KONTROLNA W STOPCE. „Początek + Σ ruchów = koniec" jest jedynym
// zdaniem mostu, które da się sprawdzić arytmetycznie, więc stopka je
// pokazuje, a rozjazd ponad 0,5 % (`bridgeReconciles`, `BRIDGE_TOLERANCE`
// z `mrrMath.ts` - ta sama tolerancja co reguła `data_quality.ledger_drift`)
// zamienia podpis w baner `role="alert"`: most, który się nie domyka, to
// błąd księgi, a nie kwestia zaokrągleń.
//
// NIGDY SUMA WALUT. Każda waluta ma własny wodospad i własną stopkę - kurs
// z dnia odczytu zmieniałby historię przy każdym odświeżeniu.
//
// REDAKTOR NIE WOŁA RPC FINANSOWEGO. Bez roli administratora zapytanie ma
// bramkę `roleOk: false` (wyłączone), a w miejscu mostu stoi
// `LockedMetricTile` - ta sama geometria, powód słowami.
import { useId } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ChartCard } from "@/components/admin/analytics/ChartCard";
import { biChart } from "@/components/admin/analytics/biChart";
import { LockedMetricTile } from "@/components/admin/revenue/atoms/LockedMetricTile";
import { ProvenanceNote } from "@/components/admin/revenue/atoms/ProvenanceNote";
import { HubCardState } from "@/components/admin/revenue/overview/HubCardState";
import { cardStatusOf } from "@/components/admin/revenue/overview/hubWindow";
import { Button } from "@/components/ui/button";
import { currencyExponent, formatMoneyMinor } from "@/lib/analytics/semantic/format";
import { chartLangFrom, type ChartLang } from "@/lib/charts/format";
import { ensureI18n as ensureFinanceI18n } from "@/lib/i18n-admin-revenue-finance";
import { ensureI18n } from "@/lib/i18n-admin-revenue-tabs";
import type { MrrBridgeCurrencyRow } from "@/lib/revenue/finance/dto";
import {
  bridgeReconciles,
  bridgeResidualMinor,
  type BridgeParts,
} from "@/lib/revenue/finance/mrrMath";
import { revenueMrrBridgeQueryOptions } from "@/lib/revenue/finance/queries";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

export interface MrrBridgeCardProps {
  tenantId: string | null;
  /** Dokładne role sesji (`useAuth().roles`) - kwoty tylko dla administratora. */
  roles: readonly string[];
  range: RevenueRange;
  /** Segment z adresu; `all` i brak to ten sam odczyt (ten sam klucz). */
  segment: RevenueSegment | null;
  variant?: "full" | "compact";
}

/** Segment w kluczu mostu: „wszystkie" = `null`, żeby Kokpit i Przychód dzieliły wpis cache. */
function bridgeSegmentOf(segment: RevenueSegment | null): string | null {
  return segment === null || segment === "all" ? null : segment;
}

/** Ruchy mostu bez filarów: otwarcie księgi i pięć rodzajów ruchu. */
function bridgeMovementsMinor(parts: BridgeParts): number {
  return (
    parts.openingMinor +
    parts.newMinor +
    parts.expansionMinor +
    parts.reactivationMinor +
    parts.contractionMinor +
    parts.churnMinor
  );
}

/** Kroki wodospadu (bez otwarcia, gdy księga go w oknie nie ma). */
function waterfallSteps(row: MrrBridgeCurrencyRow): { key: string; minor: number }[] {
  const steps = [
    { key: "adminRevenue.finance.bridge.start", minor: row.startMinor },
    ...(row.openingMinor !== 0
      ? [{ key: "adminRevenue.finance.movementKind.opening", minor: row.openingMinor }]
      : []),
    { key: "adminRevenue.finance.movementKind.new", minor: row.newMinor },
    { key: "adminRevenue.finance.movementKind.expansion", minor: row.expansionMinor },
    { key: "adminRevenue.finance.movementKind.reactivation", minor: row.reactivationMinor },
    { key: "adminRevenue.finance.movementKind.contraction", minor: row.contractionMinor },
    { key: "adminRevenue.finance.movementKind.churn", minor: row.churnMinor },
    { key: "adminRevenue.finance.bridge.end", minor: row.endMinor },
  ];
  return steps;
}

export function MrrBridgeCard({
  tenantId,
  roles,
  range,
  segment,
  variant = "full",
}: MrrBridgeCardProps) {
  ensureFinanceI18n();
  ensureI18n();
  const { t, i18n } = useTranslation();
  const lang = chartLangFrom(i18n.language);
  const headingId = useId();
  const isAdmin = roles.includes("admin");
  const query = useQuery(
    revenueMrrBridgeQueryOptions(tenantId, range, bridgeSegmentOf(segment), { roleOk: isAdmin }),
  );

  if (!isAdmin) {
    return (
      <div data-testid="mrr-bridge" data-variant={variant} data-locked="admin_only">
        <LockedMetricTile label={t("adminRevenue.finance.bridge.title")} reason="admin_only" />
      </div>
    );
  }

  const status = cardStatusOf(query, tenantId);
  let body;
  if (status !== "ready") {
    body = (
      <HubCardState
        status={status}
        forbiddenKey="adminRevenue.finance.state.forbidden"
        unavailableKey="adminRevenue.finance.state.unavailable"
        onRetry={() => void query.refetch()}
      />
    );
  } else if (query.data?.state === "ready") {
    const bridge = query.data.data;
    const day = new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "pl-PL", { dateStyle: "long" });
    if (bridge.currencies === null) {
      body = (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {bridge.dataSince
            ? t("adminRevenue.finance.bridge.unknownWindow", {
                date: day.format(localDay(bridge.dataSince)),
              })
            : t("adminRevenue.finance.bridge.emptyLedger")}
        </p>
      );
    } else if (bridge.currencies.length === 0) {
      body = (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {t("adminRevenue.mrr.bridge.noSubscriptions")}
        </p>
      );
    } else {
      body = (
        <div className={variant === "full" ? "space-y-4" : "space-y-2"}>
          {bridge.currencies.map((row) =>
            variant === "full" ? (
              <BridgeChart key={row.currency} row={row} lang={lang} />
            ) : (
              <BridgeLine key={row.currency} row={row} lang={lang} />
            ),
          )}
        </div>
      );
    }
    body = (
      <>
        {body}
        <ProvenanceNote
          dataSince={bridge.dataSince}
          basisMix={bridge.basisMix}
          environment="live"
        />
      </>
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      data-testid="mrr-bridge"
      data-variant={variant}
      className="min-w-0 space-y-2"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={headingId} className="text-sm font-semibold">
            {t("adminRevenue.finance.bridge.title")}
          </h3>
          {variant === "full" ? (
            <p className="m-0 text-xs text-muted-foreground">
              {t("adminRevenue.finance.bridge.subtitle")}
            </p>
          ) : null}
        </div>
        {variant === "compact" ? (
          <Button asChild size="sm" variant="outline" className="h-7">
            <Link to="/admin/revenue/$tab" params={{ tab: "mrr" }}>
              {t("adminRevenue.mrr.bridge.openFull")}
            </Link>
          </Button>
        ) : null}
      </div>
      {body}
    </section>
  );
}

/** `YYYY-MM-DD` jako lokalna północ - bez przesunięcia strefy (AGENTS: daty lokalne). */
function localDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** Stopka mostu: suma kontrolna i jej werdykt (baner przy rozjeździe > 0,5 %). */
function BridgeFooter({ row, lang }: { row: MrrBridgeCurrencyRow; lang: ChartLang }) {
  const { t } = useTranslation();
  const money = (minor: number) => formatMoneyMinor(minor, row.currency, lang);
  const reconciles = bridgeReconciles(row);
  return (
    <div className="space-y-1" data-reconciled={reconciles ? "true" : "false"}>
      <p className="m-0 text-xs tabular-nums text-muted-foreground" data-role="bridge-equation">
        {t("adminRevenue.mrr.bridge.equation", {
          start: money(row.startMinor),
          movements: money(bridgeMovementsMinor(row)),
          end: money(row.endMinor),
        })}
      </p>
      {reconciles ? (
        <p className="m-0 flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t("adminRevenue.finance.bridge.reconciled")}
        </p>
      ) : (
        <p
          role="alert"
          data-testid="mrr-bridge-drift"
          className="m-0 flex items-start gap-1.5 rounded-[6px] border border-destructive/40 bg-destructive/10 p-2 text-xs text-foreground"
        >
          <AlertTriangle
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {t("adminRevenue.finance.bridge.notReconciled", {
            amount: money(bridgeResidualMinor(row)),
          })}
        </p>
      )}
    </div>
  );
}

/** Wariant pełny: wodospad jednej waluty z tabelą danych silnika i stopką. */
function BridgeChart({ row, lang }: { row: MrrBridgeCurrencyRow; lang: ChartLang }) {
  const { t } = useTranslation();
  const steps = waterfallSteps(row);
  const scale = 10 ** currencyExponent(row.currency);
  const categories = steps.map((step) => t(step.key));
  const values = steps.map((step) => step.minor / scale);
  const title = t("adminRevenue.mrr.bridge.chartTitle", { currency: row.currency });
  return (
    <div data-currency={row.currency}>
      <ChartCard
        title={title}
        config={biChart({
          kind: "waterfall",
          categories,
          series: [{ name: row.currency, values }],
          unit: ` ${row.currency}`,
          showLegend: false,
          lang,
        })}
        csv={{
          filename: `mrr-bridge-${row.currency.toLowerCase()}`,
          headers: [t("adminRevenue.mrr.bridge.csvStep"), row.currency],
          rows: steps.map((step, index) => [categories[index], step.minor / scale]),
        }}
        footer={<BridgeFooter row={row} lang={lang} />}
      />
    </div>
  );
}

/** Wariant zwarty (Kokpit): jedna waluta = jedna linia + ta sama stopka. */
function BridgeLine({ row, lang }: { row: MrrBridgeCurrencyRow; lang: ChartLang }) {
  const { t } = useTranslation();
  const money = (minor: number) => formatMoneyMinor(minor, row.currency, lang);
  return (
    <div data-currency={row.currency} className="space-y-1 rounded-[6px] border border-border p-2">
      <p className="m-0 flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{row.currency}</span>
        <span className="tabular-nums">
          {t("adminRevenue.mrr.bridge.startToEnd", {
            start: money(row.startMinor),
            end: money(row.endMinor),
          })}
        </span>
      </p>
      <p className="m-0 text-xs tabular-nums text-muted-foreground">
        {t("adminRevenue.mrr.bridge.netNew", { amount: money(row.netNewMinor) })}
      </p>
      <BridgeFooter row={row} lang={lang} />
    </div>
  );
}
