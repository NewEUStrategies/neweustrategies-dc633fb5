// Zdejmowanie stanu wskazania TAPNIĘCIEM POZA elementem.
//
// PO CO TO ISTNIEJE. Na dotyku nie ma hovera: `pointerenter` przychodzi przy
// dotknięciu, a `pointerleave` natychmiast po podniesieniu palca - więc
// wykres oparty wyłącznie na parze enter/leave migał tooltipem i gasł, czyli
// był na telefonie MARTWY. Reguła interakcji brzmi: tapnięcie USTAWIA stan,
// tapnięcie poza elementem go ZDEJMUJE. Pierwszą połowę robi zwykły handler
// wskaźnika; drugą trzeba obsłużyć nasłuchem na dokumencie, bo zdarzenie
// dzieje się poza drzewem komponentu.
//
// DLACZEGO `pointerdown`, A NIE `click`. Klik na elemencie, który nie jest
// przyciskiem, bywa w ogóle nie generowany (przeciągnięcie, przewinięcie),
// a `pointerdown` przychodzi zawsze i przed przewinięciem - więc stan zdejmuje
// się w momencie, w którym czytelnik faktycznie sięga gdzie indziej.
//
// DLACZEGO NIE `mousedown` RÓWNIEŻ. Nasłuch jest aktywny tylko wtedy, gdy stan
// jest ustawiony, i tylko wtedy, gdy ustawił go wskaźnik NIEMYSZOWY: przy
// myszy stan zdejmuje `pointerleave`, więc drugi mechanizm byłby wyłącznie
// źródłem wyścigów.
import { useEffect, type RefObject } from "react";

export function useTapAwayDismiss(
  enabled: boolean,
  ref: RefObject<HTMLElement | null>,
  dismiss: () => void,
): void {
  useEffect(() => {
    if (!enabled || typeof document === "undefined") return;
    const onDown = (e: PointerEvent): void => {
      const root = ref.current;
      if (!root) return;
      // `composedPath` zamiast `contains`, bo cel może leżeć w cieniu (SVG
      // w portalu, web component) - a wtedy `contains` zwraca fałsz dla
      // elementu, który wizualnie jest wewnątrz.
      const inside = e.composedPath().includes(root);
      if (!inside) dismiss();
    };
    // `capture`, żeby zdjęcie stanu wyprzedziło handlery, które mogą zdarzenie
    // zatrzymać (karuzele, panele przesuwane palcem).
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [enabled, ref, dismiss]);
}
