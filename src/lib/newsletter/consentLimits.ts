// LIMITY ŁADUNKU ZGÓD - JEDNO ŹRÓDŁO DLA KLIENTA I SERWERA (I9d-Y2b, reguła
// AGENTS „Share contact limits across client/server validation").
//
// Liczba pozycji `consents` w jednym zapisie: walidacja funkcji serwerowych
// (`newsletter.functions.ts`, `contact.functions.ts`) i licznik pól zgody
// dokumentu buildera newslettera (NlDoc) czytają TĘ stałą - formularz nie
// pozwoli zbudować ładunku, który serwer odrzuci. 12 = dokument z wieloma
// polami zgody + zgoda na newsletter + deklaracja osobnego pola pomiaru.
//
// MODUŁ CZYSTY I LIŚĆ: bez zależności (chunki czytelnika i serwer).

/** Najwięcej pozycji `consents` w jednym ładunku zapisu (zod `.max()`). */
export const CONSENT_ENTRIES_MAX = 12;
