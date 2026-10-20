// Macierz porównania planów - zsynchronizowana z REALNYM stanem tenanta:
//   * kolumny = warstwy faktycznie skonfigurowane w panelu (membership_tiers,
//     przekazane jako `tiers` - już zawężone do bieżącego segmentu),
//   * wiersze egzekwowane (feature) wyliczają ✓/- z prawdziwych `tier.features`
//     (tierHasFeature), więc tabela pokazuje FAKTYCZNY zakres dostępu wg planu -
//     zmiana flagi w panelu /admin/membership natychmiast zmienia komórkę,
//   * wiersze redakcyjne (values per tier.key) niosą różnice nieujęte flagą
//     (limit analiz, zobowiązania procesowe [P] katalogu v6.2 z liczbą albo
//     terminem: onboarding, noty, konsultacje, zjazdy),
//   * gdzie flaga i karta v6.2 mówią co innego, macierz pokazuje PRAWDĘ
//     BRAMKI - np. Zespół najemcy sprzed decyzji właściciela z 2026-10-20
//     ma kanał bezpośredni („bez limitu") zamiast puli 3 zapytań z v6.2
//     (brak obniżki w opłaconym okresie), a nowy najemca - dokładnie pulę 3;
//     tracker Zespołu i zakres Partnera dla NGO wynikają już z flag (I9b),
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
  tierExpertRequestQuota,
  tierFeatureNumber,
  tierHasFeature,
  tierName,
  type MembershipTierRow,
} from "@/lib/billing/tiers";

type CellValue = "check" | "dash" | string;

/** Wiersze wyliczane z realnych, nieboolowskich danych warstwy (nie flagą 0/1). */
type MatrixDerive = "expertRequest" | "includedTicket";

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

// Klucze katalogu v6.2 (`pricing_catalog_v62_rows`). Kolumnę renderujemy
// tylko jeśli warstwa o tym kluczu jest w przekazanych `tiers` - wołający sam
// dobiera kolumny (segment indywidualny / instytucje / akademicki).
//
// `corporate` i `business` (Enterprise ukryty, Partner Biznesowy wycofany -
// `pricing_visible = false`) SĄ na liście: o widoczności decyduje powierzchnia,
// nie macierz. Powierzchnie sprzedażowe (/pricing, /plans, /membership-join)
// podają wyłącznie `listedTiers`, a profil obecnego klienta takiego progu
// dokłada jego kolumnę - inaczej porównanie progów nie miałoby kolumny
// „Twój plan", choć próg działa. Wiersze flag liczą się z jego `features`,
// redakcyjne - z progu, którego zakres obejmuje (`EDITORIAL_SCOPE_OF`).
const KNOWN_TIER_KEYS = [
  "corporate",
  "business",
  "reader",
  "member",
  "pro",
  "vip",
  "partner",
  "partner_general",
  "presidents_circle",
  "student",
  "educator",
  "ngo",
  "team",
] as const;

/**
 * Progi POZA prezentacją v6.2 nie mają własnych wartości redakcyjnych, a ich
 * karta obiecuje „pełen zakres Pro" (Partner Biznesowy) i „pulę miejsc Pro"
 * (Enterprise). Bez tego zastępstwa obecny klient takiego progu czytał
 * w kolumnie „Twój plan" kreskę („Nie") przy archiwum, koncie NES czy
 * cotygodniowym przeglądzie - treściach, które `has_content_access` mu daje,
 * a decyzje 3/4 każą mu zachować. Słownik celowo nie wymienia tych kluczy
 * (powierzchnie sprzedażowe ich nie pokazują); zastępstwo żyje tu, przy
 * jedynym miejscu, które ich kolumnę renderuje.
 */
const EDITORIAL_SCOPE_OF: Readonly<Record<string, string>> = {
  corporate: "pro",
  business: "pro",
};

/**
 * Wiersze o WARUNKACH SPRZEDAŻY, nie o zakresie dostępu - nie przechodzą
 * zastępstwem: próg wycofany albo ukryty nie jest kupowany na warunkach Pro.
 */
const SALE_TERMS_ROWS: ReadonlySet<string> = new Set(["cancelAnytime"]);

function editorialValue(row: MatrixRow, tier: MembershipTierRow): CellValue {
  const own = row.values?.[tier.key];
  if (own !== undefined) return own;
  const scope = EDITORIAL_SCOPE_OF[tier.key];
  if (!scope || SALE_TERMS_ROWS.has(row.id)) return "dash";
  return row.values?.[scope] ?? "dash";
}

function cellFor(row: MatrixRow, tier: MembershipTierRow, t: TFunction): CellValue {
  // „Zapytanie do eksperta": realna liczba z planu (Członek/Pro, Zespół
  // nowego najemcy) lub „bez limitu, bezpośrednio" dla progów pisania wprost
  // (Rada+, Zespół najemcy istniejącego). Zero => brak (kreska).
  if (row.derive === "expertRequest") {
    if (tierHasFeature(tier.features, "chat_direct_gated")) {
      return t("pricing.comparisonMatrix.expertRequestDirect");
    }
    const quota = tierExpertRequestQuota(tier.features);
    return quota > 0 ? t("pricing.comparisonMatrix.perMonth", { n: quota }) : "dash";
  }
  // Bilet wliczony (katalog v6.2): pula ORGANIZACJI wygrywa z pulą osoby (Zespół:
  // 3 rocznie niezależnie od liczby miejsc), stawki ulgowe dostają zniżkę
  // zamiast biletu. Liczby z `features` - ta sama prawda co bramka
  // `my_ticket_allowance`, nie zdanie redakcji.
  if (row.derive === "includedTicket") {
    const perOrg = tierFeatureNumber(tier.features, "included_event_tickets_org");
    if (perOrg > 0) return t("pricing.comparisonMatrix.ticketPerOrg", { n: perOrg });
    const perYear = tierFeatureNumber(tier.features, "included_event_tickets");
    if (perYear > 0) return t("pricing.comparisonMatrix.ticketPerYear", { n: perYear });
    const discount = tierFeatureNumber(tier.features, "event_ticket_discount_pct");
    return discount > 0 ? t("pricing.comparisonMatrix.ticketDiscount", { pct: discount }) : "dash";
  }
  if (row.feature) return tierHasFeature(tier.features, row.feature) ? "check" : "dash";
  return editorialValue(row, tier);
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
