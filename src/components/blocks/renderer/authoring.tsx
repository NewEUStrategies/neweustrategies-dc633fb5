// Tryb panelu dla renderera bloków.
//
// Ten sam `BlocksRenderer` maluje treść czytelnikowi i podgląd w panelu
// (kanwa buildera, podgląd wpisu). Część bloków ma diagnostykę, której
// czytelnik nie może zobaczyć - np. plakietka „Nieobsłużony shortcode”
// zamiast surowego `[nazwa …]`. Domyślnie `false`: publiczna trasa nie
// ustawia providera, więc SSR i hydratacja czytelnika zawsze dają ten sam
// (pusty) wynik.
import { createContext, useContext, type ReactNode } from "react";

const BlocksAuthoringContext = createContext(false);

/**
 * Oznacza poddrzewo jako podgląd w panelu (diagnostyka bloków widoczna).
 * `authoring={false}` zostawia widok czytelnika - pozwala owinąć drzewo
 * warunkowo bez zmiany jego kształtu.
 */
export function BlocksAuthoringProvider({
  authoring = true,
  children,
}: {
  authoring?: boolean;
  children: ReactNode;
}) {
  return (
    <BlocksAuthoringContext.Provider value={authoring}>{children}</BlocksAuthoringContext.Provider>
  );
}

/** Czy bloki renderują się w panelu (a nie czytelnikowi). */
export function useBlocksAuthoring(): boolean {
  return useContext(BlocksAuthoringContext);
}
