// Znacznik "ten render dzieje się WEWNĄTRZ kanwy edytora" + tryb wizualny,
// który kanwa wymusza niezależnie od globalnego ThemeProvidera (ten nadal
// rządzi resztą admina). Gdy kontekst jest obecny, widgety i panel właściwości
// rozstrzygają `ThemedValue<T>` względem trybu wybranego w edytorze.
//
// DLACZEGO TO MIESZKA W `content-model`, A NIE W `builder`
// Providera montuje wyłącznie builder (`Builder.tsx`, `WidgetLivePreview.tsx`),
// ale KONSUMENTEM jest `postContext` - czyli warstwa wspólna dla obu silników
// treści. Gdyby ten moduł został pod `lib/builder/`, `content-model` musiałby
// importować z buildera i cykl `bloki <-> builder` wróciłby jedno piętro niżej,
// tym razem jako `content-model -> builder`. Warstwa wspólna definiuje
// PYTANIE ("czy jestem w kanwie edytora i w jakim trybie?"), a silnik na nie
// ODPOWIADA, montując providera.
import { createContext, useContext, type ReactNode } from "react";

/** Tryb wizualny wymuszany przez kanwę edytora. Źródło prawdy dla `Themed<T>`. */
export type Mode = "light" | "dark";

const BuilderModeContext = createContext<Mode | null>(null);

export function BuilderModeProvider({ mode, children }: { mode: Mode; children: ReactNode }) {
  return <BuilderModeContext.Provider value={mode}>{children}</BuilderModeContext.Provider>;
}

/** Zwraca tryb kanwy edytora albo `null`, gdy render idzie poza builderem. */
export function useBuilderMode(): Mode | null {
  return useContext(BuilderModeContext);
}
