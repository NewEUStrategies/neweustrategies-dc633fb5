// Kiedy hub osoby (/author/$slug) może być indeksowany przez wyszukiwarki.
//
// DRUGA WARSTWA, nie jedyna. Historycznie ten moduł był JEDYNĄ mitygacją
// dziury w `profiles_public` (definer + GRANT dla `anon`, zawężenie wyłącznie po
// tenant_id): każdy profil tenanta - także zwykłego członka - był osiągalny pod
// /author/<slug|uuid>, a `noindex` jest prośbą do crawlera, nie kontrolą
// dostępu. Interfejs obiecywał przy tym w PL i EN, że osoby niezalogowane
// dostępu nie mają.
//
// DOSTĘP zamyka teraz baza: migracja 20260806160000 dała widokowi dwie
// addytywne warstwy widoczności, a warstwa publiczna wymaga realnej publicznej
// obecności (profile_has_public_presence). Goły profil członka nie wychodzi już
// z Data API dla `anon` - nie ma czego indeksować ani czym enumerować.
//
// Ten moduł został przy swojej właściwej roli: INDEKSACJI. Zbiór profili
// osiągalnych publicznie jest szerszy niż zbiór wart indeksowania (konto
// redakcyjne bez dorobku jest osiągalne, ale nie zasługuje na wpis w Google),
// więc hub nadal dostaje `noindex`, dopóki nie ma odznaki eksperta albo
// kurowanego dorobku. Dane pochodzą z ładunku huba - bez dodatkowego I/O.

export interface ProfileIndexSignals {
  /** Ma odznakę "expert" (kurowany ekspert). */
  isExpert: boolean;
  /** Liczba znormalizowanych materiałów (publikacje/raporty/wideo/podcasty/wydarzenia). */
  materialCount: number;
  /** Członkostwa w programach (relacja redakcyjna/kurowana). */
  programCount: number;
  /** Przypisane obszary ekspertyzy. */
  areaCount: number;
  /** Publiczne wzmianki medialne. */
  mediaMentionCount: number;
}

/**
 * Czy profil ma publiczną obecność uzasadniającą indeksację. Zachowawczo:
 * brak jakiegokolwiek sygnału → strona prywatnego członka → noindex.
 */
export function isIndexableProfile(signals: ProfileIndexSignals): boolean {
  return (
    signals.isExpert ||
    signals.materialCount > 0 ||
    signals.programCount > 0 ||
    signals.areaCount > 0 ||
    signals.mediaMentionCount > 0
  );
}

/** Wartość nagłówka robots dla huba osoby - hinty AI overview tylko gdy indeksujemy. */
export function profileRobots(indexable: boolean): string {
  return indexable ? "index, follow, max-image-preview:large, max-snippet:-1" : "noindex, nofollow";
}
