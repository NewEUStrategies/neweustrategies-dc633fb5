// Kiedy hub osoby (/author/$slug) może być indeksowany przez wyszukiwarki.
//
// PROBLEM: profiles_public zawęża tylko po tenant_id (bez bramki discoverable),
// więc każdy profil - także zwykłego członka, który nie wyraził zgody na
// widoczność w katalogu - był osiągalny pod /author/<slug|uuid> i miał na sztywno
// `robots: index, follow`. Skutek: strony niezgłoszonych do katalogu członków
// (imię, avatar, bio, stanowisko, linki social) trafiały do indeksu Google.
//
// ROZWIĄZANIE (minimalne, bez zmiany powierzchni danych, którą współdzieli
// wiele bylinów/avatarów): indeksujemy wyłącznie profile z realną PUBLICZNĄ
// obecnością - ekspert (odznaka) albo kurowany dorobek (materiały, programy,
// obszary ekspertyzy, obecność medialna). Goły profil członka bez żadnego z tych
// sygnałów dostaje noindex. Dane pochodzą z ładunku huba - bez dodatkowego I/O.

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
