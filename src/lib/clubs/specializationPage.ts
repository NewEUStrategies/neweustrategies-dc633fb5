// Strona specjalizacji klubu (`/club/specialization/$slug`) - REGUŁY, nie układ.
//
// CO BYŁO W JSX-IE TRASY. Trzy wyrażenia wpisane w drzewo renderu, z których
// każde jest decyzją produktową, a nie sposobem rozstawienia elementów:
//
//   1. `CLUB_SPECIALIZATIONS.filter((other) => other.slug !== spec.slug)` -
//      stopka z przejściami do POZOSTAŁYCH specjalizacji. Reguła brzmi: podaj
//      wszystkie SIEDEM i ani razu tę, na której czytelnik już stoi. Zgubiony
//      warunek daje odnośnik prowadzący na tę samą stronę (dla wyszukiwarki:
//      link własny na ośmiu stronach, dla człowieka: klik bez skutku),
//      a odwrócony - stopkę z jedną pozycją, czyli utratę całej nawigacji
//      poprzecznej między obszarami.
//   2. `signedIn ? t("club.spec.clubsEmpty") : t("club.spec.clubsAnon")` -
//      komunikat pustej sekcji klubów. To NIE jest kosmetyka: RPC pokazuje
//      anonimowi wyłącznie kluby `public`, więc jego pustka znaczy „zaloguj
//      się, żeby zobaczyć resztę", a pustka u zalogowanego znaczy „w tym
//      obszarze faktycznie nie ma jeszcze klubu". Jeden komunikat dla obu
//      stanów kłamie w jednym z nich.
//   3. `search={{ spec: spec.slug }}` przy jedynym CTA strony - cały lejek tej
//      trasy. Formularz zgłoszenia czyta `?spec=` i preselekcjonuje obszar;
//      literówka w nazwie parametru nie psuje niczego widocznego, tylko cofa
//      kandydata do wyboru z listy - a to najdroższe pole tego formularza.
//
// GRANICA WARSTWY. Zero Reacta, zero i18n, zero Supabase. Funkcje zwracają
// KLUCZE i18n oraz deskryptory; tekst składa trasa. Katalog specjalizacji
// (slugi, ikony, numery) jest w `./specializations` i to on jest źródłem prawdy
// - tutaj mieszkają wyłącznie reguły widoku zbudowane NAD nim.
import { CLUB_SPECIALIZATIONS, type ClubSpecialization } from "./specializations";

/**
 * Filar członkostwa: nagłówek i zdanie pod nim. Deskryptor, a nie tekst -
 * strona jest dwujęzyczna, więc treść mieszka w słowniku.
 *
 * DWA klucze na filar są tu wymogiem, nie wygodą: kafel bez zdania
 * wyjaśniającego to nagłówek zawieszony nad pustką, a właśnie te trzy zdania
 * są jedyną odpowiedzią strony na pytanie „co dostaję w środku", zadane
 * bezpośrednio przed CTA.
 */
export interface SpecializationPillar {
  readonly titleKey: string;
  readonly descKey: string;
}

/** Trzy filary wartości członkostwa - kolejność jest redakcyjna. */
export const SPECIALIZATION_PILLARS: readonly SpecializationPillar[] = [
  { titleKey: "club.spec.pillarAccess", descKey: "club.spec.pillarAccessDesc" },
  { titleKey: "club.spec.pillarIntel", descKey: "club.spec.pillarIntelDesc" },
  { titleKey: "club.spec.pillarNetwork", descKey: "club.spec.pillarNetworkDesc" },
];

/**
 * Pozostałe specjalizacje - wszystkie POZA podanym slugiem.
 *
 * Slug nieznany (adres z literówki, obszar wycofany z katalogu) nie jest tu
 * błędem: stopka ma wtedy oddać pełny zestaw, bo to jedyna droga powrotna
 * z takiej strony.
 */
export function otherClubSpecializations(slug: string): readonly ClubSpecialization[] {
  return CLUB_SPECIALIZATIONS.filter((other) => other.slug !== slug);
}

/**
 * Klucz komunikatu pustej sekcji klubów. Gość dostaje zaproszenie do
 * zalogowania, zalogowany - informację o stanie obszaru.
 */
export function specializationClubsEmptyKey(signedIn: boolean): string {
  return signedIn ? "club.spec.clubsEmpty" : "club.spec.clubsAnon";
}

/** Parametry adresu formularza zgłoszenia - kontrakt lejka tej strony. */
export interface SpecializationApplySearch {
  readonly spec: string;
}

/**
 * Adres CTA: `/club/apply?spec=<slug>`. Osobna funkcja, bo nazwa parametru
 * jest kontraktem MIĘDZY dwiema trasami (`club.apply` czyta ją w
 * `validateSearch`), a nie szczegółem tego widoku.
 */
export function specializationApplySearch(slug: string): SpecializationApplySearch {
  return { spec: slug };
}
