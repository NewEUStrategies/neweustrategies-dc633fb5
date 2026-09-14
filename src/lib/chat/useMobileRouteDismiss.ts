// Na telefonie wyjście na inną stronę SKŁADA czat, a nie zostawia go
// rozwartego nad treścią.
//
// DLACZEGO EFEKT, A NIE RENDER. Punkt przełamania (`sm`) zna wyłącznie CSS,
// więc odczyt szerokości w ciele renderu byłby rozjazdem hydratacji: serwer
// nie wie, jak szeroki jest ekran. `matchMedia` czytamy dopiero w efekcie
// wywołanym ZMIANĄ ścieżki - to zawsze klient i zawsze po hydratacji.
//
// DLACZEGO PIERWSZE URUCHOMIENIE JEST POMIJANE. Efekt biegnie także przy
// montażu; gdyby wtedy wołał `dismiss`, czat zamykałby się w tej samej
// klatce, w której użytkownik go otworzył.
import { useEffect, useRef } from "react";

/** Mobilny zakres doku - bliźniak breakpointu `sm` Tailwinda (640px). */
export const MOBILE_DOCK_MEDIA_QUERY = "(max-width: 639.98px)";

export function isMobileDockViewport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(MOBILE_DOCK_MEDIA_QUERY).matches;
}

/**
 * Woła `dismiss` przy KAŻDEJ zmianie `pathname`, ale tylko na wąskim ekranie.
 * Domknięcie trzymamy w referencji, żeby świeża funkcja z renderu nie
 * przezbrajała efektu i nie dawała drugiego wywołania dla tej samej nawigacji.
 */
export function useMobileRouteDismiss(pathname: string, dismiss: () => void): void {
  const seen = useRef(pathname);
  const latest = useRef(dismiss);
  latest.current = dismiss;

  useEffect(() => {
    if (seen.current === pathname) return;
    seen.current = pathname;
    if (!isMobileDockViewport()) return;
    latest.current();
  }, [pathname]);
}
