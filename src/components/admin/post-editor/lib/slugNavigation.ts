// Reguła adresu wpisu po zapisie, wyjęta 1:1 z `usePostEditorForm`.
//
// DLACZEGO TO JEST OSOBNA, TESTOWALNA REGUŁA. Serwer może znormalizować slug
// (`uniqueSlug` dopisuje sufiks przy kolizji z innym wpisem tego najemcy).
// Nawigacja MUSI iść na slug faktycznie zapisany - przejście na slug wpisany
// w formularzu załadowałoby CUDZY wpis, który ten slug już posiada. Redaktor
// widziałby wtedy w edytorze obcą treść pod swoim tytułem („podmiana"
// edytowanego posta), a następny autosave zapisałby ją na tamtym wierszu.
//
// Trzy porównania, które to rozstrzygają, siedziały jako trzy osobne `if`-y
// w środku 130-linijkowego `saveFn` i nie dało się ich wywołać z testu.

export interface CanonicalSlugInput {
  /** `slug` zwrócony przez serwer (może być znormalizowany). */
  savedSlug: string | null | undefined;
  /** `slug` z zapisywanej migawki formularza. */
  snapshotSlug: string;
  /** `slug` z adresu, na którym stoi edytor. */
  routeSlug: string;
}

export interface CanonicalSlugDecision {
  /** Slug, którego od teraz trzyma się edytor. */
  canonicalSlug: string;
  /** Serwer zmienił slug -> pokaż ostrzeżenie i zsynchronizuj pole formularza. */
  slugChanged: boolean;
  /** Adres trasy przestał zgadzać się ze stanem -> przekieruj (replace). */
  needsNavigate: boolean;
}

/**
 * Rozstrzyga, jaki slug obowiązuje po zapisie i co z tego wynika dla UI.
 *
 * Brak sluga w odpowiedzi serwera (starsza ścieżka zapisu albo odpowiedź bez
 * ciała) cofa się do sluga z migawki - nigdy do pustego stringa, bo nawigacja
 * na pusty slug wyrzuciłaby redaktora z edytora.
 */
export function resolveCanonicalSlug({
  savedSlug,
  snapshotSlug,
  routeSlug,
}: CanonicalSlugInput): CanonicalSlugDecision {
  const canonicalSlug = savedSlug ?? snapshotSlug;
  return {
    canonicalSlug,
    slugChanged: canonicalSlug !== snapshotSlug,
    needsNavigate: canonicalSlug !== routeSlug,
  };
}
