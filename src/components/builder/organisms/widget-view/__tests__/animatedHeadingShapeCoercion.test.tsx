// Widget „animated-heading” na stronie: zapisany kształt spoza katalogu.
//
// Ścieżka strony (WidgetView -> SimpleWidgets -> leniwy AnimatedHeadingRender)
// przekazywała zapisany napis kształtu rzutem typu, bez sprawdzenia katalogu.
// Nieznana wartość (literówka, usunięty kształt, śmieci z importu) nie rysowała
// żadnego SVG, a pusty zapis w trybie hover dawał zwykłe podkreślenie zamiast
// efektu najechania - podczas gdy panel w obu przypadkach pokazywał coś innego.
// Tu przypinamy, że strona rysuje to samo, co panel: kształt domyślny trybu.
//
// Granice jak w `simpleWidgetsContentRobustness.test.tsx`: prawdziwy WidgetView,
// rejestr leniwych widgetów -> lustro eager, klient Supabase -> pusty łańcuch,
// react-i18next -> echo `defaultValue`. Porównujemy treść nagłówka z nagłówkiem
// zapisanym z kształtem domyślnym - bez wpisywania geometrii SVG do testu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  type Builder = Record<string, unknown> & { then: (r: (v: unknown) => unknown) => unknown };
  const builder = {} as Builder;
  for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle"]) {
    (builder as Record<string, unknown>)[m] = vi.fn(() => builder);
  }
  builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return {
    supabase: { from: vi.fn(() => builder), rpc: vi.fn(async () => ({ data: [], error: null })) },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

/** Nagłówek widgetu dla danego zapisu kształtu (reszta treści stała). */
function heading(shape: unknown, mode = "highlight") {
  const node: WidgetNode = {
    id: "w-ah-shape",
    kind: "widget",
    type: "animated-heading",
    content: {
      mode,
      shape,
      textBefore_pl: "Rozwijamy",
      highlight_pl: "Europę",
      loop: false,
    } as WidgetContent,
  };
  const { container, unmount } = render(
    <QueryClientProvider client={new QueryClient()}>
      <WidgetView node={node} lang="pl" device="desktop" editable={false} />
    </QueryClientProvider>,
  );
  const h2 = container.querySelector("h2");
  const result = { html: h2?.innerHTML ?? "", hasSvg: h2?.querySelector("svg") != null };
  unmount();
  return result;
}

describe("animated-heading na stronie: kształt spoza katalogu", () => {
  it.each([
    ["nieznana nazwa", "wave"],
    ["nie-napis z importu", 7],
  ])("%s rysuje domyślne podkreślenie, nie gołe wyróżnienie", (_, shape) => {
    const page = heading(shape);
    expect(page.hasSvg).toBe(true);
    expect(page.html).toBe(heading("underline").html);
  });

  it("brak kształtu w trybie hover - podkreślenie to pierwszy efekt najechania, nie kreska SVG", () => {
    const page = heading("", "hover-underline");
    expect(page.hasSvg).toBe(false);
    expect(page.html).toBe(heading("hover-line-1", "hover-underline").html);
  });

  it("kształt z katalogu dociera do strony bez zmian", () => {
    expect(heading("zigzag").html).not.toBe(heading("underline").html);
    expect(heading("zigzag").hasSvg).toBe(true);
  });
});
