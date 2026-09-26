// Wiersze partnerów Z PANELU -> model PUBLICZNEGO pasa poziomów.
//
// PO CO TO ISTNIEJE. Publiczne `event_sponsors_public` ma w ciele
// `AND e.status = 'published'`, więc szkicowi wydarzenia oddaje pustkę -
// a podgląd w studiu ma pokazać partnerów, których organizator WŁAŚNIE
// przypiął. Wiersze `admin_event_sponsors_list` niosą komplet pól poziomu
// potrzebny pasowi (`tier_*`); sekcja „Partnerzy" rysuje dodatkowo opis
// i korzyści poziomu, a tych lista przypięć nie niesie - dokłada je
// `admin_event_sponsor_tiers_list` (opcja `tiers`), zapytanie, które studio
// i tak trzyma w cache pod kluczem poziomów.
//
// KOLEJNOŚĆ JEST LUSTREM PUBLICZNEJ: ranga malejąco, przy remisie `sort_order`
// poziomu, dopiero potem klucz - dokładnie `ORDER BY` z
// `event_sponsors_public` (20260824094504). Grupa bez poziomu na końcu, w grupie
// `sort_order` przypięcia, a przy remisie nazwa. Dwie różne kolejności
// znaczyłyby, że redaktor układa pas w podglądzie inaczej, niż zobaczy go
// uczestnik.
//
// NIEOGŁOSZONE PRZYPIĘCIA WYPADAJĄ - CHYBA ŻE WOŁAJĄCY PROSI O NIE WPROST.
// `is_published = false` to partner jeszcze nieogłoszony. Domyślnie mapper go
// odsiewa, bo tak liczy się sponsor przy sesji i ścieżce programu (tam podgląd
// ma obiecywać tylko to, co zobaczy uczestnik). Podgląd strony głównej
// i zakładki „Partnerzy" prosi o nie opcją `includeDrafts` i dostaje je
// ZNACZONE (`isDraft`) - tablica „Sponsorzy i reklama" zapisuje nowe logo jako
// nieogłoszone, więc bez tego organizator widział logotypy na tablicy
// i pustkę w podglądzie, bez słowa wyjaśnienia.
import type { EventSponsorRow, EventSponsorTierRow } from "@/lib/events/sponsorsApi";
import type {
  PublicSponsor,
  PublicSponsorTier,
  SponsorLogoSize,
  SponsorRole,
} from "@/lib/events/sponsorsSurface";
import {
  SPONSOR_LOGO_SIZES,
  SPONSOR_ROLES,
  parseSponsorTierBenefits,
} from "@/lib/events/sponsorsSurface";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function roleOf(value: unknown): SponsorRole {
  const raw = text(value);
  return raw !== null && (SPONSOR_ROLES as readonly string[]).includes(raw)
    ? (raw as SponsorRole)
    : "sponsor";
}

function logoSizeOf(value: unknown): SponsorLogoSize {
  const raw = text(value);
  return raw !== null && (SPONSOR_LOGO_SIZES as readonly string[]).includes(raw)
    ? (raw as SponsorLogoSize)
    : "md";
}

export interface SponsorTiersFromAdminRowsOptions {
  /**
   * Wiersze `admin_event_sponsor_tiers_list`: opis, korzyści i `sort_order`
   * poziomu. Brak (zapytanie w locie) = pas bez opisów, a remis rangi
   * rozstrzyga klucz - pas nie czeka na drugie zapytanie, żeby się narysować.
   */
  tiers?: readonly EventSponsorTierRow[] | null;
  /** `true` = także przypięcia nieogłoszone, oznaczone `isDraft: true`. */
  includeDrafts?: boolean;
}

export function sponsorTiersFromAdminRows(
  rows: readonly EventSponsorRow[] | null | undefined,
  opts: SponsorTiersFromAdminRowsOptions = {},
): PublicSponsorTier[] {
  if (rows === null || rows === undefined) return [];

  const tierById = new Map((opts.tiers ?? []).map((tier) => [tier.id, tier]));
  const groups = new Map<string, PublicSponsorTier>();

  for (const row of rows) {
    const isDraft = row.is_published !== true;
    if (isDraft && opts.includeDrafts !== true) continue;
    // Nazwa jest jedyną treścią pozycji dla czytnika ekranu - migawka bez niej
    // wypada tak samo, jak w publicznym parserze.
    const name = text(row.snapshot_name) ?? text(row.crm_name);
    const id = text(row.id);
    if (id === null || name === null) continue;

    const tierId = text(row.tier_id);
    const key = tierId ?? "__no_tier__";
    const details = tierId === null ? undefined : tierById.get(tierId);
    const tier = groups.get(key) ?? {
      tierId,
      key: text(row.tier_key),
      namePl: text(row.tier_name_pl),
      nameEn: text(row.tier_name_en),
      // Opis i korzyści poziomu rysuje sekcja „Partnerzy", nie pas logotypów.
      // Bez wiersza poziomu zostają puste, zamiast być zgadywane z przypięć.
      descriptionPl: text(details?.description_pl),
      descriptionEn: text(details?.description_en),
      rank: typeof row.tier_rank === "number" ? row.tier_rank : 0,
      accentColor: text(row.tier_accent_color),
      logoSize: logoSizeOf(row.tier_logo_size),
      benefits: parseSponsorTierBenefits(details?.benefits ?? null),
      sponsors: [],
    };

    const sponsor: PublicSponsor = {
      id,
      name,
      logoUrl: text(row.snapshot_logo_url) ?? text(row.crm_logo_url),
      websiteUrl: text(row.snapshot_website) ?? text(row.crm_website),
      descriptionPl: text(row.snapshot_description_pl),
      descriptionEn: text(row.snapshot_description_en),
      country: text(row.snapshot_country) ?? text(row.crm_country),
      role: roleOf(row.role),
      boothLabel: text(row.booth_label),
      sortOrder: typeof row.sort_order === "number" ? row.sort_order : tier.sponsors.length,
      isDraft,
    };

    tier.sponsors = [...tier.sponsors, sponsor];
    groups.set(key, tier);
  }

  // `sort_order` poziomu spoza listy poziomów idzie na koniec remisu - tak jak
  // `NULLS LAST` w `ORDER BY` publicznej funkcji.
  const tierSortOrder = (tierId: string): number =>
    tierById.get(tierId)?.sort_order ?? Number.MAX_SAFE_INTEGER;

  return [...groups.values()]
    .map((tier) => ({
      ...tier,
      sponsors: [...tier.sponsors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => {
      // Grupa bez poziomu jest JEDNA (klucz `__no_tier__`), więc po tej linii
      // oba poziomy mają identyfikator.
      if (a.tierId === null || b.tierId === null) return a.tierId === null ? 1 : -1;
      return (
        b.rank - a.rank ||
        tierSortOrder(a.tierId) - tierSortOrder(b.tierId) ||
        (a.key ?? "").localeCompare(b.key ?? "")
      );
    });
}

/**
 * STAN LISTY PRZYPIĘĆ W PODGLĄDZIE. Pusta lista partnerów znaczy trzy różne
 * rzeczy: „jeszcze pytam", „zapytanie padło" i „partnerów nie ma" - a tylko
 * ostatnia może powiedzieć organizatorowi „dodaj ich na tablicy". Bez tego
 * rozróżnienia awaria RPC wracała jako objaw ze zgłoszenia (partnerów
 * w podglądzie nie widać), tyle że z fałszywym wyjaśnieniem.
 */
export type PreviewSponsorsStatus =
  { state: "pending" } | { state: "error"; message: string } | { state: "ready" };

/** Stałe, a nie nowe obiekty - status wchodzi do tablic zależności nakładki. */
export const PREVIEW_SPONSORS_PENDING: PreviewSponsorsStatus = { state: "pending" };
export const PREVIEW_SPONSORS_READY: PreviewSponsorsStatus = { state: "ready" };

/** Tyle stanu zapytania, ile potrzeba do statusu - bez wiązania z react-query. */
export interface PreviewSponsorsQueryState {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus: "fetching" | "paused" | "idle";
}

/**
 * Status listy przypięć z samego zapytania `admin_event_sponsors_list`.
 *
 * LISTA POZIOMÓW NIE WCHODZI DO STATUSU. Kto jest partnerem, mówi lista
 * przypięć; poziomy wnoszą tylko opis, korzyści i remis `sort_order` - bez nich
 * pas i sekcja rysują się dalej (patrz `SponsorTiersFromAdminRowsOptions.tiers`).
 *
 * WYŁĄCZONE ZAPYTANIE NIE JEST WCZYTYWANIEM. Bez wydarzenia (`eventId` puste)
 * zapytanie zostaje `pending` NA ZAWSZE przy `fetchStatus = "idle"` - licząc je
 * jako wczytywanie, podgląd pokazywałby szkielet, który nigdy nie zniknie.
 * Wstrzymane (`"paused"`, brak sieci) nadal czeka, więc dalej jest wczytywaniem.
 */
export function previewSponsorsStatus(
  query: PreviewSponsorsQueryState,
  describeError: (error: unknown) => string,
): PreviewSponsorsStatus {
  if (query.isError) return { state: "error", message: describeError(query.error) };
  if (query.isPending && query.fetchStatus !== "idle") return PREVIEW_SPONSORS_PENDING;
  return PREVIEW_SPONSORS_READY;
}
