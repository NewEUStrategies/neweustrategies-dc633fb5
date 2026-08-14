// Kontekst "sekcja nad zgięciem" publicznego renderera buildera.
//
// Widget nie zna swojej pozycji w dokumencie, więc nie może sam rozstrzygnąć,
// czy jego obraz jest kandydatem LCP (eager + fetchpriority=high), czy zwykłym
// obrazem poniżej zgięcia (lazy). Dotąd KAŻDY obraz widgetu ładował się
// leniwie - także hero-karta w pierwszej sekcji strony głównej, czyli
// dokładnie element LCP. Renderer (BuilderRenderer) zna indeks sekcji i
// dostarcza tę informację w dół drzewa; widgety oznaczają priorytetem
// wyłącznie swój PIERWSZY obraz, więc liczba eager-obrazów jest ograniczona
// konstrukcyjnie (maks. jeden na widget, tylko w czołowych sekcjach).
//
// Wartość jest czysta pochodną dokumentu (indeks sekcji vs ABOVE_FOLD_SECTION_COUNT),
// identyczna w SSR i pierwszym renderze klienta - zero ryzyka rozjazdu hydratacji.
import { createContext, useContext, type ReactNode } from "react";

const AboveFoldContext = createContext(false);

export function AboveFoldProvider({
  aboveFold,
  children,
}: {
  aboveFold: boolean;
  children: ReactNode;
}) {
  return <AboveFoldContext.Provider value={aboveFold}>{children}</AboveFoldContext.Provider>;
}

/** Czy bieżący widget renderuje się w sekcji nad zgięciem (kandydat LCP). */
export function useAboveFold(): boolean {
  return useContext(AboveFoldContext);
}
