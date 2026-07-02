// Regresja: gdy widget `heading` nie ma własnego rozmiaru czcionki
// (`sizePx` = 0 i `sizePreset` puste), MUSI dziedziczyć globalne
// ustawienia z Theme Design (superadmin) - `--td-pt-size` / `--td-pe-size` -
// zamiast fallbackować na twarde klasy Tailwind (`text-3xl`, `text-sm`).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
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

function renderHeading(content: Record<string, unknown>) {
  const node: WidgetNode = {
    id: "h-1",
    kind: "widget",
    type: "heading",
    content: { text_pl: "Tytuł", subtitle_pl: "Podtytuł", ...content },
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang="pl" device="desktop" />
    </QueryClientProvider>,
  );
}

describe("heading widget - fallback do globalnych ustawień Theme Design", () => {
  it("bez sizePx i bez sizePreset: tytuł używa var(--td-pt-size), nie klasy text-3xl", () => {
    const { container } = renderHeading({});
    const h2 = container.querySelector("h2");
    expect(h2).toBeTruthy();
    // Brak twardej klasy Tailwind text-3xl (globalna czcionka wygrywa).
    expect(h2?.className).not.toMatch(/\btext-3xl\b/);
    // Inline style referuje globalny token Theme Design.
    expect(h2?.getAttribute("style") || "").toContain("var(--td-pt-size");
  });

  it("bez subtitleSizePx: podtytuł używa var(--td-pe-size)", () => {
    const { container } = renderHeading({});
    const p = container.querySelector("p");
    expect(p?.getAttribute("style") || "").toContain("var(--td-pe-size");
    // Nie ma już twardej klasy text-sm.
    expect(p?.className).not.toMatch(/\btext-sm\b/);
  });

  it("jawnie wybrany sizePreset='lg' NADAL działa (nie nadpisujemy świadomego wyboru)", () => {
    const { container } = renderHeading({ sizePreset: "lg" });
    const h2 = container.querySelector("h2");
    expect(h2?.className).toMatch(/\btext-4xl\b/);
    expect(h2?.getAttribute("style") || "").not.toContain("var(--td-pt-size");
  });

  it("jawnie ustawiony sizePx wygrywa nad globalnym fallbackiem", () => {
    const { container } = renderHeading({ sizePx: 42 });
    const h2 = container.querySelector("h2");
    const style = h2?.getAttribute("style") || "";
    expect(style).toContain("font-size: 42px");
    expect(style).not.toContain("var(--td-pt-size");
  });
});
