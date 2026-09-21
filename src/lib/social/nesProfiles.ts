// ADRESY PROFILI FUNDACJI - jedno miejsce w kodzie na to, gdzie NES naprawdę
// jest w mediach społecznościowych.
//
// TO NIE JEST DRUGIE „jedno źródło prawdy" OBOK `globalSocialLinks.ts`.
// Tamten moduł odpowiada na pytanie „co redakcja wpisała w panelu" i z natury
// nie zna żadnego adresu - czyta je z `site_settings`. Ten odpowiada na inne
// pytanie: „jakie adresy WYSYŁAMY, zanim ktokolwiek cokolwiek wpisze" - czyli
// stopka maili systemowych i seedy migracji. Bez tego drugiego miejsca adresy
// rozłażą się po literałach i rozjeżdżają, co dokładnie się stało:
//   * stopka maili niosła `x.com/NEStrategies`,
//   * strona /kontakt - `x.com/NewEUStrategies`,
//   * stopka witryny - `https://twitter.com/`, czyli STRONĘ GŁÓWNĄ SERWISU.
// Trzy powierzchnie, trzy różne odpowiedzi na to samo pytanie.
//
// PUSTY ADRES JEST ODPOWIEDZIĄ, A NIE BRAKIEM. Widget `social-icons` przy
// domyślnym `showEmpty` w ogóle nie rysuje kafelka bez linku
// (`SimpleWidgets.tsx`: `if (!active && !showEmpty) return null`), więc pusty
// wpis = brak ikony. Link do `https://youtube.com/` jest GORSZY niż brak
// ikony YouTube: obiecuje profil fundacji, a oddaje stronę główną serwisu.
// Dlatego platformy, dla których nie znamy profilu NES, zostają tu puste.

/** Platformy, które umie narysować widget `social-icons` (klucze kanoniczne). */
export const NES_SOCIAL_PLATFORMS = [
  "facebook",
  "x",
  "youtube",
  "instagram",
  "linkedin",
  "spotify",
] as const;

export type NesSocialPlatform = (typeof NES_SOCIAL_PLATFORMS)[number];

/**
 * Profile fundacji. Pusty napis = „nie znamy profilu NES na tej platformie"
 * i ma nim zostać, dopóki redakcja nie poda adresu - patrz nagłówek.
 *
 * Wszystkie sześć platform ma już potwierdzone profile NES; redakcja może je
 * nadpisać w Admin → Wygląd → Opcje motywu → „Ikony social".
 */
export const NES_PROFILE_URLS: Readonly<Record<NesSocialPlatform, string>> = {
  facebook: "https://www.facebook.com/NewEuropeanStrategies",
  x: "https://x.com/NewEUStrategies",
  youtube: "https://www.youtube.com/@NewEuropeanStrategies",
  instagram: "https://www.instagram.com/new.eustrategies/",
  linkedin: "https://www.linkedin.com/company/new-european-strategies/",
  spotify: "https://open.spotify.com/show/7GuZqsCXg0qOb3rde1IhdN",
} as const;

/** Adres kontaktowy fundacji (domena zgodna z `SITE_CANONICAL_ORIGIN`). */
export const NES_CONTACT_EMAIL = "office@neweuropeanstrategies.com";

/**
 * Czy adres wskazuje KONKRETNY profil, a nie stronę główną serwisu.
 *
 * To jest cała usterka zgłoszona przez redakcję, sprowadzona do predykatu:
 * `https://twitter.com/` i `https://x.com/NewEUStrategies` są oba poprawnymi
 * URL-ami i oba przechodzą przez `safeUrl`, ale tylko drugi prowadzi tam,
 * gdzie ikona obiecuje. Różnica jest jedna: czy za hostem stoi jeszcze
 * jakikolwiek segment ścieżki.
 */
export function isSocialProfileUrl(href: string): boolean {
  const trimmed = href.trim();
  if (!/^https?:\/\/[^/]/i.test(trimmed)) return false;
  const afterHost = trimmed.replace(/^https?:\/\/[^/?#]+/i, "");
  const firstSegment = afterHost.replace(/^\/+/, "").replace(/[/?#].*$/, "");
  return firstSegment !== "";
}
