// `noindex` dla ekranów błędu renderowanych PO STRONIE PRZEGLĄDARKI.
//
// KONTEKST (zgłoszenie 2026-10-09): w wynikach Google na nazwę marki pojawił
// się sitelink „Problem z połączeniem" ze snippetem „Co zrobić? 1 Sprawdź, czy
// masz aktywne połączenie...", czyli treść `FriendlyErrorPage` (scenariusz
// `network`) zaindeksowana jako zwykła strona serwisu. Ten hook NIE jest
// odpowiedzią na ten przypadek (patrz „KIEDY NIE" niżej) - obsługuje stany
// trwałe, które przy renderze po stronie klienta miały ten sam defekt.
//
// SKĄD TO SIĘ BIERZE. Błąd w SSR kończy się statusem 4xx/5xx i nie jest
// indeksowany. Ekran błędu, który powstaje dopiero w przeglądarce, ma za sobą
// odpowiedź HTTP 200 i bez dodatkowego sygnału jest dla wyszukiwarki
// pełnoprawną treścią adresu. Dla widoków „strony nie ma" w aplikacjach
// JavaScript Google zaleca dokładnie ten mechanizm: dopisać `<meta
// name="robots" content="noindex">` skryptem
// (https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics#avoid-soft-404s).
//
// KIEDY NIE. Błąd CHWILOWY (sieć, nieudany import chunku po wdrożeniu,
// przekroczony czas w rendererze Googlebota) trafia się na adresie, który
// istnieje - noindex wyrzuciłby z indeksu poprawną stronę do czasu
// następnego udanego renderu. O tym, kiedy hook jest aktywny, decyduje
// wołający (`FriendlyErrorPage`: 404/410 i wymagane logowanie).
//
// DLACZEGO OSOBNY ELEMENT, A NIE EDYCJA ISTNIEJĄCEGO. `<meta name="robots">`
// z `head()` trasy należy do `HeadContent` routera - zmiana jego atrybutu
// zostałaby nadpisana przy następnej nawigacji albo rozjechałaby się z drzewem
// Reacta. Drugi znacznik jest bezpieczny: przy kilku dyrektywach robots
// wyszukiwarka stosuje najbardziej restrykcyjną. Znacznik znika razem z ekranem
// błędu, więc udane ponowienie albo nawigacja przywracają indeksowalność.
import { useEffect } from "react";

/** Atrybut znacznika - pozwala testom i diagnostyce odróżnić go od `head()`. */
export const ERROR_NOINDEX_ATTR = "data-nes-error-noindex";

export function useErrorNoindex(active = true): void {
  useEffect(() => {
    if (!active) return;
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", "noindex");
    meta.setAttribute(ERROR_NOINDEX_ATTR, "");
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [active]);
}
