// Kuratowana macierz porównania planów - najważniejsze różnice między
// Essential a płatnymi warstwami. W przeciwieństwie do generycznej
// ComparisonTable (unia benefitów) tutaj mamy stałą, redakcyjnie dopasowaną
// listę rzędów per tier.key -> wartość ("check" | "dash" | tekst). Renderujemy
// tylko dla tych kolumn (tierów), które faktycznie są na ekranie, więc każdy
// segment dostaje właściwe zestawienie bez martwych kolumn.
import { useTranslation } from "react-i18next";
import { Check, Minus } from "lucide-react";
import { tierName, type MembershipTierRow } from "@/lib/billing/tiers";

type CellValue = "check" | "dash" | string;

type MatrixRow = {
  id: string;
  label: string;
  values: Record<string, CellValue>;
};

// Klucze tierów uznane za "Essential vs pozostałe" - kolumny renderujemy tylko
// jeśli faktycznie występują w bieżącym segmencie (cardTiers).
const KNOWN_TIER_KEYS = [
  "reader",
  "essential",
  "plus",
  "pro",
  "business",
  "team",
  "student",
  "lecturer",
] as const;

export function PricingComparisonMatrix({
  tiers,
  lang,
}: {
  tiers: MembershipTierRow[];
  lang: string;
}) {
  const { t } = useTranslation();

  // Filtrujemy do tierów, dla których w i18n są zdefiniowane wartości - dzięki
  // temu segmenty typu B2B / Edukacja same z siebie schowają matrix, dopóki
  // redakcja nie wprowadzi im kolumn (żadnych pustych tabel na produkcji).
  const columns = tiers.filter((tier) =>
    (KNOWN_TIER_KEYS as readonly string[]).includes(tier.key),
  );
  if (columns.length < 2) return null;

  const raw = t("pricing.comparisonMatrix.rows", { returnObjects: true });
  const rows = Array.isArray(raw) ? (raw as MatrixRow[]) : [];
  if (rows.length === 0) return null;

  // Wiersz jest przydatny tylko wtedy, gdy przynajmniej jedna widoczna kolumna
  // niesie wartość - pusty rząd byłby wizualnym szumem.
  const visibleRows = rows.filter((row) =>
    columns.some((tier) => row.values[tier.key] !== undefined),
  );
  if (visibleRows.length === 0) return null;

  const renderCell = (value: CellValue | undefined) => {
    if (value === undefined || value === "dash") {
      return (
        <Minus
          className="mx-auto h-4 w-4 text-muted-foreground/40"
          aria-label={t("common.no", { defaultValue: "Nie" })}
        />
      );
    }
    if (value === "check") {
      return (
        <Check
          className="mx-auto h-4 w-4 text-brand"
          aria-label={t("common.yes", { defaultValue: "Tak" })}
        />
      );
    }
    return <span className="text-sm font-medium text-foreground">{value}</span>;
  };

  return (
    <section
      className="mx-auto mt-16 max-w-5xl"
      aria-labelledby="pricing-matrix-heading"
      lang={lang}
    >
      <header className="text-center">
        <h2
          id="pricing-matrix-heading"
          className="text-2xl font-bold tracking-tight text-foreground"
        >
          {t("pricing.comparisonMatrix.title")}
        </h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
          {t("pricing.comparisonMatrix.subtitle")}
        </p>
      </header>

      <div className="mt-6 overflow-x-auto rounded-[6px] border border-border">
        <table className="w-full min-w-[560px] text-sm">
          <caption className="sr-only">{t("pricing.comparisonMatrix.title")}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th
                scope="col"
                className="p-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("pricing.comparisonMatrix.featureColumn")}
              </th>
              {columns.map((tier) => (
                <th
                  key={tier.id}
                  scope="col"
                  className={
                    tier.highlight
                      ? "p-3 text-center text-sm font-semibold text-brand"
                      : "p-3 text-center text-sm font-semibold text-foreground"
                  }
                >
                  {tierName(tier, lang)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <th
                  scope="row"
                  className="p-3 text-left text-sm font-normal text-foreground"
                >
                  {row.label}
                </th>
                {columns.map((tier) => (
                  <td key={tier.id} className="p-3 text-center align-middle">
                    {renderCell(row.values[tier.key])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
