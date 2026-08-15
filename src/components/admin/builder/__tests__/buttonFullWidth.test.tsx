// Regresja: ustawienie "Szerokość" widgetu `button` było no-opem.
//
// Klasa przycisku zawierała bezwarunkowe `w-full`, więc opcja "automatyczna"
// nic nie zmieniała, a jedyny efekt `fullWidth` (dodatkowe `justify-center`)
// był duplikatem klasy, która i tak już tam była. Do tego kanwa i strona
// publiczna rozjeżdżały się przy tej samej konfiguracji: w kanwie przycisk
// siedzi w `ResizableBox` (inline-flex o szerokości auto, więc `w-full`
// zwijało się do treści), a publicznie wrappera nie ma i `w-full` rozciągało
// przycisk na całą kolumnę.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetNode } from "@/lib/builder/types";

// Podział kodu (React.lazy) zamieniony na importy statyczne - bez tego pierwszy
// render leniwych widgetów (w tym kanwowego Editable) pokazuje fallback Suspense.
// Lustro eager jest kontraktowo identyczne z rejestrem.
vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.then = (r: (v: unknown) => unknown) => r({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

function markup(content: Record<string, unknown>, editable = false): string {
  const node: WidgetNode = {
    id: "btn-1",
    kind: "widget",
    type: "button",
    content: { label_pl: "Kliknij", href: "/x", ...content },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <WidgetView
        node={node}
        lang="pl"
        device="desktop"
        editable={editable}
        onContentChange={editable ? () => {} : undefined}
      />
    </QueryClientProvider>,
  );
}

/** Klasy przycisku (element z `inline-flex items-center justify-center`). */
function buttonClasses(html: string): string {
  const match = html.match(/class="(inline-flex items-center justify-center[^"]*)"/);
  expect(match, "element przycisku").toBeTruthy();
  return match ? match[1] : "";
}

describe("button: ustawienie szerokości realnie działa", () => {
  it('"automatyczna" daje szerokość do treści (w-auto, bez w-full)', () => {
    const cls = buttonClasses(markup({ fullWidth: "auto" }));
    expect(cls.split(/\s+/)).toContain("w-auto");
    expect(cls.split(/\s+/)).not.toContain("w-full");
  });

  it('"100%" daje pełną szerokość (w-full, bez w-auto)', () => {
    const cls = buttonClasses(markup({ fullWidth: "full" }));
    expect(cls.split(/\s+/)).toContain("w-full");
    expect(cls.split(/\s+/)).not.toContain("w-auto");
  });

  it("brak ustawienia zachowuje się jak automatyczna", () => {
    expect(buttonClasses(markup({})).split(/\s+/)).toContain("w-auto");
  });

  it("nierozpoznana wartość degraduje do automatycznej, nie do 100%", () => {
    expect(buttonClasses(markup({ fullWidth: "1" })).split(/\s+/)).toContain("w-auto");
  });
});

describe("button: kanwa i strona publiczna dają ten sam kontrakt szerokości", () => {
  it('"100%" rozciąga też wrapper kanwy (grid + justify-items: stretch)', () => {
    const canvas = markup({ fullWidth: "full" }, true);
    const publicHtml = markup({ fullWidth: "full" });
    for (const html of [canvas, publicHtml]) {
      expect(html).toContain('data-button-full-width="1"');
      expect(html).toMatch(/justify-items:\s*stretch/);
      expect(buttonClasses(html).split(/\s+/)).toContain("w-full");
    }
  });

  it('"automatyczna" nie dokłada wrappera po żadnej stronie', () => {
    for (const html of [markup({ fullWidth: "auto" }, true), markup({ fullWidth: "auto" })]) {
      expect(html).not.toContain("data-button-full-width");
      expect(buttonClasses(html).split(/\s+/)).toContain("w-auto");
    }
  });

  it("jawna szerokość w px wygrywa nad rozciąganiem", () => {
    const canvas = markup({ fullWidth: "full", widthPx: 240 }, true);
    expect(canvas).toContain('data-button-full-width="1"');
    expect(canvas).toMatch(/width:\s*240px/);
  });
});
