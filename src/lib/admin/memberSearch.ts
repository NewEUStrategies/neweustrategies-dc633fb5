// Pomocnicze (czyste) do wyszukiwarki członków w panelu admina - np. picker
// odbiorcy odznaki. Zapytanie leci na public.profiles i jest ograniczone przez
// RLS do tenanta wołającego (polityka "authenticated read":
// tenant_id = current_tenant_id() AND is_staff()), więc admin nigdy nie zobaczy
// profili z obszaru roboczego innej firmy - bez filtra tenant_id po stronie
// klienta. Tu trzymamy tylko logikę bez efektów (mapowanie wiersza, detekcja
// UUID), aby dało się ją przetestować jednostkowo.

/** Kolumny, do których `authenticated` ma grant SELECT na profiles (bez PII). */
export interface MemberProfileRow {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  slug: string | null;
  verified_at: string | null;
}

/** Znormalizowana opcja wyboru członka pokazywana w pickerze. */
export interface MemberOption {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  slug: string | null;
  verified: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Czy tekst wygląda na pełny UUID (fallback: wklejenie surowego id). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Minimalna długość frazy, od której odpytujemy bazę (poza wklejonym UUID). */
export const MEMBER_SEARCH_MIN_CHARS = 2;

/** Czy fraza jest gotowa do zapytania: pełny UUID albo min. próg znaków. */
export function shouldQueryMembers(term: string): boolean {
  const t = term.trim();
  return isUuid(t) || t.length >= MEMBER_SEARCH_MIN_CHARS;
}

/** Wiersz profilu → opcja pickera; nazwa spada na slug, potem na id. */
export function mapMemberRow(row: MemberProfileRow): MemberOption {
  const name = (row.display_name ?? "").trim();
  return {
    id: row.id,
    displayName: name || row.slug || row.id,
    avatarUrl: row.avatar_url,
    slug: row.slug,
    verified: row.verified_at != null,
  };
}
