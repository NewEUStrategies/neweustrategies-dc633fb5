// Regresja: gdy widget `heading` nie ma własnych wartości typografii
// (rozmiar / waga / line-height), MUSI dziedziczyć globalne tokeny
// Theme Design (superadmin) - `--td-pt-*` / `--td-pe-*` - zamiast
// fallbackować na twarde klasy Tailwind lub magiczne liczby.
//
// JSDOM odrzuca wartości `var(...)` w `element.style.*`, dlatego
// weryfikujemy wyrenderowany HTML przez `renderToStaticMarkup` (SSR),
// który zachowuje surowy `style="..."` atrybut niezależnie od CSSOM.
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/admin/builder/WidgetView";
import type { WidgetNode } from "@/lib/builder/types";

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
}));

afterEach(cleanup);

function markupHeading(content: Record<string, unknown>): string {
  const node: WidgetNode = {
    id: "h-1",
    kind: "widget",
    type: "heading",
    content: { text_pl: "Tytuł", subtitle_pl: "Podtytuł", ...content },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
}

describe("heading widget - fallback do globalnych ustawień Theme Design", () => {
  it("bez sizePx i bez sizePreset: tytuł używa var(--td-pt-size) i var(--td-pt-lh) w inline style", () => {
    const html = markupHeading({});
    expect(html).toContain("var(--td-pt-size, 15px)");
    expect(html).toContain("var(--td-pt-lh, 1.3)");
    // Brak twardej klasy Tailwind (text-3xl), która wcześniej maskowała global.
    expect(html).not.toMatch(/class="[^"]*\btext-3xl\b/);
  });

  it("bez titleWeight: tytuł dziedziczy globalny var(--td-pt-weight)", () => {
    const html = markupHeading({});
    expect(html).toContain("var(--td-pt-weight, 600)");
  });

  it("bez subtitleSizePx: podtytuł używa var(--td-pe-size) i var(--td-pe-lh)", () => {
    const html = markupHeading({});
    expect(html).toContain("var(--td-pe-size, 13px)");
    expect(html).toContain("var(--td-pe-lh, 1.5)");
    expect(html).not.toMatch(/class="[^"]*\btext-sm\b/);
  });

  it("bez subtitleWeight: podtytuł dziedziczy globalny var(--td-pe-weight)", () => {
    const html = markupHeading({});
    expect(html).toContain("var(--td-pe-weight, 400)");
  });

  it("jawnie wybrany sizePreset='lg' NADAL działa - klasa text-4xl obecna, brak fallbacku do var(--td-pt-size)", () => {
    const html = markupHeading({ sizePreset: "lg" });
    expect(html).toMatch(/\btext-4xl\b/);
    expect(html).not.toContain("var(--td-pt-size");
  });

  it("jawnie ustawiony sizePx wygrywa nad globalnym fallbackiem", () => {
    const html = markupHeading({ sizePx: 42 });
    expect(html).toContain("font-size:42px");
    expect(html).not.toContain("var(--td-pt-size");
  });

  it("jawnie ustawiona waga tytułu wygrywa nad globalnym --td-pt-weight", () => {
    const html = markupHeading({ titleWeight: "900" });
    expect(html).toContain("font-weight:900");
    expect(html).not.toContain("var(--td-pt-weight");
  });

  it("jawnie ustawiona waga podtytułu wygrywa nad globalnym --td-pe-weight", () => {
    const html = markupHeading({ subtitleWeight: "700" });
    expect(html).toContain("font-weight:700");
    expect(html).not.toContain("var(--td-pe-weight");
  });
});
