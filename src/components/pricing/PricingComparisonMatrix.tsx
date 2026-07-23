// Macierz porównania planów - zsynchronizowana z REALNYM stanem tenanta:
//   * kolumny = warstwy faktycznie skonfigurowane w panelu (membership_tiers,
//     przekazane jako `tiers` - już zawężone do bieżącego segmentu),
//   * wiersze egzekwowane (feature) wyliczają ✓/- z prawdziwych `tier.features`
//     (tierHasFeature), więc tabela pokazuje FAKTYCZNY zakres dostępu wg planu -
//     zmiana flagi w panelu /admin/membership natychmiast zmienia komórkę,
//   * wiersze redakcyjne (values per tier.key) niosą różnice nieujęte flagą
//     (limit artykułów, typ newslettera, świadczenia relacyjne),
//   * kolumna planu zalogowanego użytkownika (currentTierKey, rozstrzygana
//     serwerowo per tenant przez current_membership_tier) jest podświetlona
//     z etykietą "Twój plan".
// Zawartość wierszy żyje w i18n (pricing.comparisonMatrix.rows) - jedno źródło
// PL/EN, a komponent renderuje tylko kolumny i wiersze mające pokrycie w
// bieżącym segmencie (żadnych martwych kolumn ani pustych rzędów).
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  tierFeatureNumber,
  tierHasFeature,
  tierName,
  type MembershipTierRow,
} from "@/lib/billing/tiers";

type CellValue = "check" | "dash" | string;

/** Wiersze wyliczane z realnych, nieboolowskich danych warstwy (nie flagą 0/1). */
type MatrixDerive = "expertRequest";

interface MatrixRow {
  id: string;
  label: string;
  /** Klucz flagi w `membership_tiers.features`; gdy ustawiony, komórka wynika
   *  z realnego stanu warstwy (nie z zahardkodowanej wartości). */
  feature?: string;
  /** Wyliczenie komórki z realnych danych warstwy (np. limit liczbowy). */
  derive?: MatrixDerive;
  /** Wartości redakcyjne per tier.key (fallback, gdy brak `feature`/`derive`). */
  values?: Record<string, CellValue>;
}

// Realne klucze katalogu (seed pricing_catalog_v3/v4). Kolumnę renderujemy
// tylko jeśli warstwa o tym kluczu jest w bieżącym segmencie - segment sam
// dobiera swoje kolumny (indywidualny / firmowy / akademicki).
const KNOWN_TIER_KEYS = [
  "reader",
  "member",
  "pro",
  "vip",
  "corporate",
  "partner",
  "partner_general",
  "presidents_circle",
  "student",
  "educator",
  "ngo",
  "team",
] as const;

function cellFor(row: MatrixRow, tier: MembershipTierRow, t: TFunction): CellValue {
  // „Zapytanie do eksperta": realna liczba z planu (Plus/Pro) lub „Bezpośrednio"
  // dla progów pisania wprost (VIP+). Zero => brak (kreska).
  if (row.derive === "expertRequest") {
    if (tierHasFeature(tier.features, "chat_direct_gated")) {
      return t("pricing.comparisonMatrix.expertRequestDirect");
    }
    const quota = tierFeatureNumber(tier.features, "expert_request_quota");
    return quota > 0 ? t("pricing.comparisonMatrix.perMonth", { n: quota }) : "dash";
  }
  if (row.feature) return tierHasFeature(tier.features, row.feature) ? "check" : "dash";
  return row.values?.[tier.key] ?? "dash";
}

function isPositive(value: CellValue): boolean {
  return value !== "dash";
}

export function PricingComparisonMatrix({
  tiers,
  lang,
  currentTierKey,
}: {
  tiers: MembershipTierRow[];
  lang: string;
  /** Klucz warstwy zalogowanego użytkownika (per tenant) - kolumna "Twój plan". */
  currentTierKey?: string | null;
}) {
  const { t } = useTranslation();

  const columns = tiers.filter((tier) => (KNOWN_TIER_KEYS as readonly string[]).includes(tier.key));
  if (columns.length < 2) return null;

  const raw = t("pricing.comparisonMatrix.rows", { returnObjects: true });
  const rows = Array.isArray(raw) ? (raw as MatrixRow[]) : [];
  if (rows.length === 0) return null;

  // Wiersz jest przydatny tylko, gdy przynajmniej jedna widoczna kolumna niesie
  // wartość pozytywną - pusty rząd (same "-") byłby wizualnym szumem.
  const visibleRows = rows.filter((row) =>
    columns.some((tier) => isPositive(cellFor(row, tier, t))),
  );
  if (visibleRows.length === 0) return null;

  const renderCell = (value: CellValue) => {
    if (value === "dash") {
      return (
        <Minus
          className="mx-auto h-4 w-4 text-muted-foreground/40"
          aria-label={t("pricing.comparisonMatrix.no")}
        />
      );
    }
    if (value === "check") {
      return (
        <Check
          className="mx-auto h-4 w-4 text-brand-ink"
          aria-label={t("pricing.comparisonMatrix.yes")}
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
              {columns.map((tier) => {
                const isCurrent = !!currentTierKey && tier.key === currentTierKey;
                return (
                  <th
                    key={tier.id}
                    scope="col"
                    aria-current={isCurrent ? "true" : undefined}
                    className={cn(
                      "p-3 text-center text-sm font-semibold",
                      isCurrent
                        ? "bg-brand/5 text-brand-ink"
                        : tier.highlight
                          ? "text-brand-ink"
                          : "text-foreground",
                    )}
                  >
                    {tierName(tier, lang)}
                    {isCurrent && (
                      <span className="mt-1 block text-[10px] font-medium uppercase tracking-wide text-brand-ink">
                        {t("pricing.comparisonMatrix.yourPlan")}
                      </span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visibleRows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/20">
                <th scope="row" className="p-3 text-left text-sm font-normal text-foreground">
                  {row.label}
                </th>
                {columns.map((tier) => {
                  const isCurrent = !!currentTierKey && tier.key === currentTierKey;
                  return (
                    <td
                      key={tier.id}
                      className={cn("p-3 text-center align-middle", isCurrent && "bg-brand/5")}
                    >
                      {renderCell(cellFor(row, tier, t))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mx-auto mt-3 max-w-3xl text-center text-xs text-muted-foreground">
        {t("pricing.comparisonMatrix.note")}
      </p>
    </section>
  );
}
