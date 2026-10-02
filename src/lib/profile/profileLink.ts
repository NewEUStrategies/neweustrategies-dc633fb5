// Link do osoby wyliczony w BAZIE: para (trasa, slug) albo brak linku.
//
// Karty, które pokazują inną osobę (wprowadzenia, rekomendacje, "Kto oglądał
// Twój profil"), nie wiedzą, czy wołający zobaczy ją na /people czy na
// /author - to zależy od widoczności profilu, roli autora i publicznej
// obecności. Rozstrzyga to `_profile_link_route` (20261002100000) tymi samymi
// funkcjami, których używają trasy, a RPC oddaje parę `*_slug` / `*_route`.
//
// Do tej zmiany te karty podstawiały w `$slug` IDENTYFIKATOR osoby:
// `get_member_profile` szuka wyłącznie po slugu, a przekierowanie z /author na
// /people też porównuje tylko slug - stąd "Nie znaleziono profilu", hub autora
// w miejscu /people i trwałe 404 po F5. Dlatego tu nie ma żadnego zastępstwa:
// brak sluga albo nieznana trasa to `null`, a karta pokazuje sam tekst.
//
// `undefined` jest dopuszczone celowo: na bazie sprzed migracji kolumn nie ma
// wcale i karta ma się zdegradować do tekstu, a nie do martwego adresu.
export type ProfileLinkRoute = "author" | "people";

export interface ProfileLink {
  readonly route: ProfileLinkRoute;
  readonly slug: string;
}

const ROUTES: readonly ProfileLinkRoute[] = ["author", "people"];

export function toProfileLink(
  slug: string | null | undefined,
  route: string | null | undefined,
): ProfileLink | null {
  if (!slug?.trim()) return null;
  const known = ROUTES.find((r) => r === route);
  return known ? { route: known, slug } : null;
}
