// Powrót na górę listy po ZMIANIE strony wyników - wspólny dla archiwum
// taksonomii (`TaxonomyPage`) i siatki stronicowanej (`PaginatedPostGrid`).
//
// Obie kopie, które ten hak zastępuje, przewijały „gdy `page > 1`" w efekcie
// zależnym od `page`. To dawało dwa błędy naraz:
//   * wejście prosto na `?page=2` przewijało stronę już przy PIERWSZYM
//     montażu - czytelnik nic jeszcze nie zmienił, a widok uciekał mu sprzed
//     oczu. Montaż to także powrót „wstecz" z wpisu, więc płynny skok na górę
//     mógł nadpisać przywróconą przez router (`scrollRestoration`) pozycję
//     karty, z której czytelnik wszedł we wpis,
//   * powrót ze strony 3 na 1 NIE przewijał - warunek `page > 1` odcinał
//     właśnie ten kierunek, więc czytelnik zostawał w połowie nowej listy.
// Do tego `behavior: "smooth"` było zaszyte na sztywno, wbrew systemowemu
// „ogranicz ruch".
//
// Dlatego porównujemy z POPRZEDNIĄ stroną trzymaną w refie: montaż (także
// podwójny efekt StrictMode) widzi tę samą wartość i nie przewija, a każda
// realna zmiana - w obie strony - przewija raz. Zachowanie przewijania
// czytamy w chwili zmiany (`preferredScrollBehavior`), nie w renderze.
import { useEffect, useRef } from "react";
import { preferredScrollBehavior } from "@/lib/a11y/reducedMotion";

export function useScrollTopOnPageChange(page: number): void {
  const previousPage = useRef(page);

  useEffect(() => {
    if (previousPage.current === page) return;
    previousPage.current = page;
    window.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  }, [page]);
}
