// Zegar minutowy - wspólne źródło „teraz" dla widoków, które dzielą dane
// na PRZED i PO chwili obecnej.
//
// PO CO TO ISTNIEJE. Lista wydarzeń liczy granicę zakładek „Najbliższe"
// i „Archiwum" z jednego znacznika czasu. Gdy ten znacznik zamarza na montaż
// widoku (`useMemo(() => new Date(), [])`), granica przestaje się przesuwać:
// wydarzenie, które zaczyna się przy otwartej karcie, zostaje w „Najbliższych"
// na zawsze, podczas gdy licznik zakładek - policzony w bazie funkcją `now()`
// przy każdym odświeżeniu - już liczy je jako archiwalne. Ekran pokazuje wtedy
// dwie sprzeczne prawdy jednocześnie: zakładkę z liczbą 12 i listę z 13 wierszami.
//
// DLACZEGO GRANICA MINUTY, A NIE `setInterval(60_000)`. Interwał liczony od
// montażu tyka w losowej fazie sekundy, więc dwa widoki zamontowane w odstępie
// 30 sekund mają różne „teraz" i różne klucze zapytań - ta sama lista pobiera
// się dwa razy. Zegar zrównany z granicą minuty daje WSZYSTKIM konsumentom
// identyczną wartość, więc cache TanStack Query trafia zamiast się rozdwajać.
//
// DLACZEGO TAKŻE POWRÓT DO KARTY. Karta w tle jest usypiana przez przeglądarkę
// i jej licznik przestaje tykać (albo jest dławiony do minut). Uczestnik wracający
// po godzinie zobaczyłby granicę sprzed godziny, dopóki nie kliknie odświeżenia.
// Zdarzenia `visibilitychange` i `focus` domykają tę dziurę - dokładnie te same,
// na których TanStack Query odświeża dane, więc granica i dane wracają razem.
import { useEffect, useState } from "react";

/** Znacznik zrównany w dół do pełnej minuty. */
function flooredToMinute(at: number): Date {
  return new Date(Math.floor(at / 60_000) * 60_000);
}

/**
 * Bieżąca chwila zrównana do pełnej minuty, odświeżana na granicy każdej minuty
 * oraz przy powrocie do karty.
 *
 * Wartość jest stabilna referencyjnie w obrębie minuty: dopóki minuta się nie
 * zmieni, hook zwraca ten sam obiekt `Date`, więc nadaje się do klucza zapytania
 * i do `useMemo` bez wywoływania pętli odświeżeń.
 */
export function useMinuteClock(): Date {
  const [minute, setMinute] = useState<Date>(() => flooredToMinute(Date.now()));

  useEffect(() => {
    let timer: number | undefined;

    const sync = () => {
      const next = flooredToMinute(Date.now());
      setMinute((current) => (current.getTime() === next.getTime() ? current : next));
    };

    // Pierwsze przebudzenie na NAJBLIŻSZEJ granicy minuty, dopiero potem co 60 s.
    // Bez tego zegar tyka w fazie montażu i granica przesuwa się z opóźnieniem
    // do 59 sekund względem bazy.
    const schedule = () => {
      const delay = 60_000 - (Date.now() % 60_000);
      timer = window.setTimeout(() => {
        sync();
        schedule();
      }, delay);
    };

    schedule();

    const onWake = () => {
      if (document.visibilityState === "visible") sync();
    };

    document.addEventListener("visibilitychange", onWake);
    window.addEventListener("focus", sync);

    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener("focus", sync);
    };
  }, []);

  return minute;
}
