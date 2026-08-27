// Wiersze partnerów Z PANELU -> model PUBLICZNEGO pasa poziomów.
//
// PO CO TO ISTNIEJE. Publiczne `event_sponsors_public` ma w ciele
// `AND e.status = 'published'`, więc szkicowi wydarzenia oddaje pustkę -
// a podgląd w studiu ma pokazać partnerów, których organizator WŁAŚNIE
// przypiął. Wiersze `admin_event_sponsors_list` niosą już komplet pól poziomu
// (`tier_*`), więc grupowanie liczy się z jednej odpowiedzi, bez drugiego
// zapytania o poziomy.
//
// KOLEJNOŚĆ JEST LUSTREM PUBLICZNEJ: ranga malejąco, grupa bez poziomu na
// końcu, w grupie `sort_order`, a przy remisie nazwa. Dwie różne kolejności
// znaczyłyby, że redaktor układa pas w podglądzie inaczej, niż zobaczy go
// uczestnik.
//
// NIEOPUBLIKOWANE PRZYPIĘCIA WYPADAJĄ. `is_published = false` to partner
// jeszcze nieogłoszony - podgląd strony publicznej nie może go pokazać, bo
// obiecywałby ekran, którego po publikacji nie będzie.
import type { EventSponsorRow } from "@/lib/events/sponsorsApi";
import type {
  PublicSponsor,
  PublicSponsorTier,
  SponsorLogoSize,
  SponsorRole,
} from "@/lib/events/sponsorsSurface";
import { SPONSOR_LOGO_SIZES, SPONSOR_ROLES } from "@/lib/events/sponsorsSurface";

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

export function sponsorTiersFromAdminRows(
  rows: readonly EventSponsorRow[] | null | undefined,
): PublicSponsorTier[] {
  if (rows === null || rows === undefined) return [];

  const groups = new Map<string, PublicSponsorTier>();

  for (const row of rows) {
    if (row.is_published !== true) continue;
    // Nazwa jest jedyną treścią pozycji dla czytnika ekranu - migawka bez niej
    // wypada tak samo, jak w publicznym parserze.
    const name = text(row.snapshot_name) ?? text(row.crm_name);
    const id = text(row.id);
    if (id === null || name === null) continue;

    const tierId = text(row.tier_id);
    const key = tierId ?? "__no_tier__";
    const tier = groups.get(key) ?? {
      tierId,
      key: text(row.tier_key),
      namePl: text(row.tier_name_pl),
      nameEn: text(row.tier_name_en),
      descriptionPl: null,
      descriptionEn: null,
      rank: typeof row.tier_rank === "number" ? row.tier_rank : 0,
      accentColor: text(row.tier_accent_color),
      logoSize: logoSizeOf(row.tier_logo_size),
      // Korzyści poziomu rysuje sekcja „Partnerzy", nie pas logotypów - pas
      // ich nie czyta, więc podgląd nie zgaduje ich z listy przypięć.
      benefits: [],
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
    };

    tier.sponsors = [...tier.sponsors, sponsor];
    groups.set(key, tier);
  }

  return [...groups.values()]
    .map((tier) => ({
      ...tier,
      sponsors: [...tier.sponsors].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => {
      if (a.tierId === null && b.tierId !== null) return 1;
      if (b.tierId === null && a.tierId !== null) return -1;
      return b.rank - a.rank || (a.key ?? "").localeCompare(b.key ?? "");
    });
}
