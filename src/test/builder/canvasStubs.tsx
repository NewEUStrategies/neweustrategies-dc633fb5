// Atrapy DZIECI kanwy wizualnej buildera.
//
// Kanwa nie renderuje treści dokumentu - robi to `BuilderRenderer`. Jej własną
// treścią jest WARSTWA STEROWANIA: nasłuchy na korzeniu, które z celu
// zdarzenia wyliczają najbliższy węzeł (`[data-widget-id]`, `[data-col-id]`,
// `[data-sec-id]`, `[data-section-tab-panel]`) i wołają właściwą operację.
// Dlatego renderer jest w testach atrapą emitującą DOKŁADNIE te atrybuty i nic
// więcej: sprawdzamy wtedy regułę "upuszczenie w tym miejscu = ta operacja",
// a nie wygląd widgetów, który ma własne testy.
//
// Stoi w `src/test`, bo korzystają z tego DWA pliki testowe kanwy (upuszczanie
// i pozostała warstwa sterowania), a rozjechanie się atrap między nimi byłoby
// cichym rozjechaniem się kontraktu.
import type { ReactNode } from "react";
import type { BuilderDocument, ColumnNode, SectionNode, WidgetNode } from "@/lib/builder/types";

/** Widgety układane w wierszu mają OŚ POZIOMĄ podziału (lewo/prawo). */
const INLINE_TYPES = new Set<string>(["button", "badge"]);

export interface RendererStubOptions {
  /** Identyfikator sekcji -> identyfikator panelu zakładki, którym ją owinąć. */
  tabPanels?: Record<string, string>;
}

/**
 * Kształt modułu `@/components/builder/organisms/BuilderRenderer` do
 * `vi.mock`. Dostawca pustego pickera dokłada dwa przyciski (oznaczone jako
 * chrome buildera, żeby kanwa nie ubiła im kliknięcia), bo jego `onPick` to
 * jedyna droga do wstawienia sekcji do kontenera i do zakładki.
 */
export function builderRendererStub(options: RendererStubOptions = {}): {
  BuilderEmptyPickerProvider: (props: {
    onPick: (sectionId: string, tabId: string | undefined, spans: number[]) => void;
    children: ReactNode;
  }) => ReactNode;
  BuilderRenderer: (props: { doc: BuilderDocument }) => ReactNode;
} {
  const widget = (w: WidgetNode) => (
    <div
      key={w.id}
      data-widget-id={w.id}
      data-debug-type={w.type}
      data-widget-layout={INLINE_TYPES.has(w.type) ? "inline" : undefined}
      draggable
    >
      {/* Prawdziwe widgety mają w środku linki - kanwa musi ubić nawigację,
          więc atrapa też jeden niesie. */}
      <a href={`/${w.id}`}>{w.id}</a>
    </div>
  );
  const column = (c: ColumnNode) => (
    <div key={c.id} data-col-id={c.id}>
      {(c.children ?? []).map((child) => (child.kind === "widget" ? widget(child) : null))}
    </div>
  );
  const section = (s: SectionNode) => {
    const inner = (s.children ?? []).map((child) =>
      child && child.kind === "column" ? column(child) : null,
    );
    const tabId = options.tabPanels?.[s.id];
    return (
      <div key={s.id} data-sec-id={s.id}>
        {tabId ? <div data-section-tab-panel={tabId}>{inner}</div> : inner}
      </div>
    );
  };
  return {
    BuilderEmptyPickerProvider: ({ onPick, children }) => (
      <>
        <button
          type="button"
          data-builder-chrome
          data-testid="picker-zakladka"
          onClick={() => onPick("s1", "t1", [6, 6])}
        />
        <button
          type="button"
          data-builder-chrome
          data-testid="picker-kontener"
          onClick={() => onPick("s1", undefined, [12])}
        />
        {children}
      </>
    ),
    BuilderRenderer: ({ doc }) => <div>{(doc.sections ?? []).map(section)}</div>,
  };
}

/**
 * Kształt modułu `@/components/builder/inlineEditContext` do `vi.mock`.
 * Znacznik pozwala odróżnić kanwę Z edycją w miejscu od kanwy bez niej -
 * to gałąź w drzewie renderowania, nie ozdoba.
 */
export function inlineEditProviderStub(): {
  InlineEditProvider: (props: { children: ReactNode }) => ReactNode;
} {
  return {
    InlineEditProvider: ({ children }) => (
      <>
        <span data-testid="edycja-w-miejscu" />
        {children}
      </>
    ),
  };
}
