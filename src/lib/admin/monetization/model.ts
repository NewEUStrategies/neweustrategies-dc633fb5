// Panel monetyzacji (admin) - CZYSTA logika domenowa rejestru: wpłaty,
// przydziały członkostwa i linki prezentowe w jednym widoku.
//
// Dlaczego osobny moduł bez Reacta i bez Supabase: filtr środowiska
// (`sandbox`/`live`) decyduje, KTÓRE kwoty zobaczy administrator najemcy,
// a przydział członkostwa pochodzący z darowizny dziedziczy środowisko po tej
// darowiźnie (tabela `membership_grants` nie ma własnej kolumny). Ta reguła
// musi dać się dowieść testem jednostkowym, bez montowania panelu.
//
// Izolacja najemcy NIE mieszka tutaj - egzekwuje ją warstwa serwerowa
// (`ledger.server.ts`: `tenant_id = <host tenant>`), bo klient nie może być
// źródłem prawdy o tym, czyje dane widzi.

/** Środowisko operatora płatności; `unknown` = wiersz sprzed kolumny `environment`. */
export type MonetizationEnvironment = "live" | "sandbox" | "unknown";

/** Wybór w panelu: „wszystkie" albo konkretne środowisko. */
export type EnvironmentFilter = "all" | "live" | "sandbox";

/** Kolejność = kolejność renderowania przełącznika. */
export const ENVIRONMENT_FILTERS: readonly EnvironmentFilter[] = ["all", "live", "sandbox"];

/** Sekcje rejestru - kolejność = kolejność zakładek. */
export const MONETIZATION_SECTIONS = ["donations", "grants", "giftLinks"] as const;

export type MonetizationSection = (typeof MONETIZATION_SECTIONS)[number];

export interface DonationLedgerRow {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  recurring: boolean;
  donorEmail: string | null;
  environment: MonetizationEnvironment;
  createdAt: string;
  paidAt: string | null;
}

export interface GrantLedgerRow {
  id: string;
  userId: string;
  tierKey: string;
  source: string;
  note: string | null;
  sourceDonationId: string | null;
  startsAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface GiftLinkLedgerRow {
  id: string;
  code: string;
  postId: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  redemptionCount: number;
  maxRedemptions: number;
}

export interface MonetizationLedger {
  donations: DonationLedgerRow[];
  grants: GrantLedgerRow[];
  giftLinks: GiftLinkLedgerRow[];
}

/**
 * Surowa wartość kolumny `donations.environment` -> domena.
 * NULL/pusto/nieznana etykieta = `unknown`, nigdy ciche „live": wiersz sprzed
 * migracji nie może udawać wpłaty produkcyjnej w sprawozdaniu.
 */
export function normalizeEnvironment(raw: string | null | undefined): MonetizationEnvironment {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "live" || value === "production") return "live";
  if (value === "sandbox" || value === "test") return "sandbox";
  return "unknown";
}

/**
 * Czy wiersz przechodzi filtr. Wiersze `unknown` przechodzą ZAWSZE - filtr ma
 * zawężać do środowiska, a nie ukrywać danych, których pochodzenia baza nie
 * zna (inaczej legacy wpłaty znikałyby z każdego widoku poza „wszystkie").
 */
export function matchesEnvironment(
  environment: MonetizationEnvironment,
  filter: EnvironmentFilter,
): boolean {
  if (filter === "all") return true;
  if (environment === "unknown") return true;
  return environment === filter;
}

/** Mapa `id darowizny -> środowisko` - wejście dla dziedziczenia przez nadania. */
export function donationEnvironmentIndex(
  donations: readonly DonationLedgerRow[],
): Map<string, MonetizationEnvironment> {
  return new Map(donations.map((row) => [row.id, row.environment]));
}

/**
 * Środowisko nadania: dziedziczone po darowiźnie źródłowej, w każdym innym
 * przypadku `unknown` (nadanie ręczne/kuponowe nie należy do żadnego konta
 * operatora).
 */
export function grantEnvironment(
  grant: Pick<GrantLedgerRow, "sourceDonationId">,
  index: ReadonlyMap<string, MonetizationEnvironment>,
): MonetizationEnvironment {
  if (!grant.sourceDonationId) return "unknown";
  return index.get(grant.sourceDonationId) ?? "unknown";
}

/** Rejestr zawężony do środowiska. Linki prezentowe są bezśrodowiskowe. */
export function filterLedger(
  ledger: MonetizationLedger,
  filter: EnvironmentFilter,
): MonetizationLedger {
  const donations = ledger.donations.filter((row) => matchesEnvironment(row.environment, filter));
  const index = donationEnvironmentIndex(ledger.donations);
  const grants = ledger.grants.filter((row) =>
    matchesEnvironment(grantEnvironment(row, index), filter),
  );
  return { donations, grants, giftLinks: [...ledger.giftLinks] };
}

export type GrantStatus = "active" | "revoked" | "expired" | "scheduled";

/** Status nadania w danej chwili (odwzorowanie warunków z current_membership_tier). */
export function grantStatus(
  grant: Pick<GrantLedgerRow, "startsAt" | "expiresAt" | "revokedAt">,
  now: Date,
): GrantStatus {
  if (grant.revokedAt) return "revoked";
  const nowMs = now.getTime();
  if (Date.parse(grant.startsAt) > nowMs) return "scheduled";
  if (grant.expiresAt && Date.parse(grant.expiresAt) <= nowMs) return "expired";
  return "active";
}

export type GiftLinkStatus = "active" | "revoked" | "expired" | "exhausted";

/**
 * Status linku prezentowego - lustro warunków z `redeem_gift_link`:
 * unieważnienie > wygaśnięcie > wyczerpany budżet (`cap > 0 AND count >= cap`).
 */
export function giftLinkStatus(
  link: Pick<
    GiftLinkLedgerRow,
    "expiresAt" | "revokedAt" | "redemptionCount" | "maxRedemptions"
  >,
  now: Date,
): GiftLinkStatus {
  if (link.revokedAt) return "revoked";
  if (link.expiresAt && Date.parse(link.expiresAt) <= now.getTime()) return "expired";
  if (link.maxRedemptions > 0 && link.redemptionCount >= link.maxRedemptions) return "exhausted";
  return "active";
}

export interface CurrencyTotal {
  currency: string;
  amountCents: number;
  count: number;
}

export interface MonetizationSummary {
  /** Sumy wyłącznie z wpłat rozliczonych (`paid`) - reszta to nie przychód. */
  paidTotals: CurrencyTotal[];
  donationCount: number;
  pendingCount: number;
  activeGrants: number;
  activeGiftLinks: number;
}

/** Podsumowanie kafelków. Waluty NIE są sumowane razem - każda osobno. */
export function summarizeLedger(ledger: MonetizationLedger, now: Date): MonetizationSummary {
  const totals = new Map<string, CurrencyTotal>();
  let pendingCount = 0;
  for (const row of ledger.donations) {
    if (row.status === "paid") {
      const key = row.currency.toUpperCase();
      const current = totals.get(key) ?? { currency: key, amountCents: 0, count: 0 };
      current.amountCents += row.amountCents;
      current.count += 1;
      totals.set(key, current);
    } else if (row.status === "pending") {
      pendingCount += 1;
    }
  }
  return {
    paidTotals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    donationCount: ledger.donations.length,
    pendingCount,
    activeGrants: ledger.grants.filter((g) => grantStatus(g, now) === "active").length,
    activeGiftLinks: ledger.giftLinks.filter((l) => giftLinkStatus(l, now) === "active").length,
  };
}

/**
 * Adres darczyńcy w widoku listy - panel służy do uzgadniania wpłat, nie do
 * eksportu bazy adresowej, więc pokazujemy skrót (RODO: minimalizacja).
 */
export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const name = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = name.slice(0, 2);
  return `${head}${name.length > 2 ? "***" : ""}@${domain}`;
}

/** Kod prezentowy w widoku listy - wystarczy prefiks do rozpoznania wiersza. */
export function maskGiftCode(code: string): string {
  return code.length <= 6 ? code : `${code.slice(0, 6)}...`;
}
