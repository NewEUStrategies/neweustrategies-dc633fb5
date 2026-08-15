// Realny kontekst archiwum dla widgetów buildera renderowanych w sekcji
// wyróżnionej taksonomii.
//
// REGRESJA: strony taksonomii renderowały `BuilderRenderer` bez
// `CurrentPostProvider`, a widget `archive-title` miał w rendererze zaszytą
// próbkę ("Przykładowe archiwum", 12 wpisów) - czytelnik kategorii widział
// więc wymyśloną nazwę i wymyśloną liczbę wpisów. Teraz kontekst buduje
// `buildArchiveCtx` z realnej taksonomii i realnego `total` (count z zapytania
// archiwum, scope'owany tenantem przez RLS).
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildArchiveCtx } from "@/lib/builder/archiveContext";
import { DynamicTagWidget } from "@/components/admin/builder/ui/organisms/widget-view/DynamicTagWidgets";
import { CurrentPostProvider } from "@/lib/content-model/postContext";
import { makeWidget } from "@/lib/builder/registry";
import type { TaxonomyMeta } from "@/lib/queries/archives";

const CATEGORY: TaxonomyMeta = {
  id: "c1",
  slug: "bezpieczenstwo",
  name_pl: "Bezpieczeństwo",
  name_en: "Security",
  description_pl: "Analizy o bezpieczeństwie.",
  description_en: "Security analyses.",
  featured_template_id: null,
  featured_section: null,
};

const TAG: TaxonomyMeta = {
  id: "t1",
  slug: "nato",
  name_pl: "NATO",
  name_en: "NATO",
  description_pl: null,
  description_en: null,
  featured_template_id: null,
  featured_section: null,
};

afterEach(cleanup);

describe("buildArchiveCtx", () => {
  it("niesie realną nazwę, opis i liczbę wpisów kategorii (PL)", () => {
    const ctx = buildArchiveCtx("category", CATEGORY, 37, "pl");
    expect(ctx.kind).toBe("archive");
    expect(ctx.archive).toEqual({
      type: "category",
      label: "Bezpieczeństwo",
      description: "Analizy o bezpieczeństwie.",
      count: 37,
    });
  });

  it("przełącza się na wersję angielską", () => {
    const ctx = buildArchiveCtx("category", CATEGORY, 5, "en");
    expect(ctx.archive?.label).toBe("Security");
    expect(ctx.archive?.description).toBe("Security analyses.");
  });

  it("dla tagu bez opisu nie wymyśla opisu", () => {
    const ctx = buildArchiveCtx("tag", TAG, 0, "pl");
    expect(ctx.archive?.type).toBe("tag");
    expect(ctx.archive?.description).toBeUndefined();
    expect(ctx.archive?.count).toBe(0);
  });

  it("spada na slug, gdy taksonomia nie ma żadnej nazwy", () => {
    const ctx = buildArchiveCtx("tag", { ...TAG, name_pl: "", name_en: "" }, 1, "pl");
    expect(ctx.archive?.label).toBe("nato");
  });
});

describe("archive-title z realnym kontekstem archiwum", () => {
  function renderArchiveTitle(count: number) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <CurrentPostProvider value={buildArchiveCtx("category", CATEGORY, count, "pl")}>
          <DynamicTagWidget node={makeWidget("archive-title")} lang="pl" />
        </CurrentPostProvider>
      </QueryClientProvider>,
    );
  }

  it("pokazuje realną nazwę i realną liczbę wpisów, nigdy próbki", () => {
    const { container } = renderArchiveTitle(37);
    expect(container.textContent).toContain("Bezpieczeństwo");
    expect(container.textContent).toContain("37");
    expect(container.textContent).not.toContain("Przykładowe archiwum");
    expect(container.textContent).not.toContain("12 wpisów");
  });

  it("pokazuje zero wpisów zamiast zaszytej dwunastki", () => {
    const { container } = renderArchiveTitle(0);
    expect(container.textContent).toContain("0 wpisów");
  });
});
