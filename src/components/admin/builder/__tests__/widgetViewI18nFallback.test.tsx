// Regresja: WidgetView czytał treści dwujęzyczne wzorcem
// `getStr(c, "x_" + lang) || getStr(c, "x_pl")`, czyli BEZ ostatniego ogniwa
// fallbacku. Treść wpisana wyłącznie po angielsku znikała w widoku PL:
// - `tts` dostawał pusty `customText` i czytał treść posta zamiast własnej,
// - nagłówki / CTA / karty renderowały pustkę mimo wypełnionego pola EN.
// Wszystkie te odczyty idą teraz przez `pickI18n` (żądany język -> PL -> EN).
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import type { WidgetContent, WidgetNode, WidgetType } from "@/lib/builder/types";

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
// TTS renderuje odtwarzacz leniwie i nie pokazuje surowego tekstu w DOM -
// podstawiamy sondę, żeby sprawdzić, co widget faktycznie do niego przekazuje.
vi.mock("@/components/builder/organisms/widget-view/lazyWidgets", async () => {
  // Lustro EAGER, nie prawdziwy rejestr: `text` renderuje przez leniwy
  // `RichHtmlView`, a w SSR fallback Suspense to `null` - asercja o tresci
  // EN pracowalaby na pustym divie niezaleznie od lancucha fallbackow i18n.
  const actual = await import("@/test/eagerWidgetChunks");
  return {
    ...actual,
    TtsPlayerHost: (props: { customText: string; label: string }) => (
      <div data-tts-text={props.customText} data-tts-label={props.label} />
    ),
  };
});

afterEach(cleanup);

function markup(type: WidgetType, content: WidgetContent, lang: "pl" | "en" = "pl"): string {
  const node: WidgetNode = { id: `${type}-1`, kind: "widget", type, content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <WidgetView node={node} lang={lang} device="desktop" />
    </QueryClientProvider>,
  );
}

describe("tts: własny tekst ma pełny łańcuch fallbacków", () => {
  it("widok PL bierze treść EN, gdy PL nie istnieje", () => {
    const html = markup("tts", { source: "custom", text_en: "English only body" });
    expect(html).toContain('data-tts-text="English only body"');
  });

  it("PL nadal wygrywa nad EN", () => {
    const html = markup("tts", {
      source: "custom",
      text_pl: "Polska treść",
      text_en: "English body",
    });
    expect(html).toContain('data-tts-text="Polska treść"');
  });

  it("widok EN bierze swoją treść, nie polską", () => {
    const html = markup("tts", { source: "custom", text_pl: "PL", text_en: "EN" }, "en");
    expect(html).toContain('data-tts-text="EN"');
  });

  it("etykieta też fallbackuje na EN zamiast lecieć na domyślną", () => {
    const html = markup("tts", { source: "post", label_en: "Listen now" });
    expect(html).toContain('data-tts-label="Listen now"');
  });

  it("brak jakiejkolwiek treści zostawia pusty tekst (czytanie posta)", () => {
    const html = markup("tts", { source: "post" });
    expect(html).toContain('data-tts-text=""');
  });
});

describe("pozostałe widgety: fallback EN zamiast pustki", () => {
  it("heading: tytuł i podtytuł tylko po angielsku są widoczne w PL", () => {
    const html = markup("heading", { text_en: "Only EN title", subtitle_en: "Only EN subtitle" });
    expect(html).toContain("Only EN title");
    expect(html).toContain("Only EN subtitle");
  });

  it("button: etykieta tylko po angielsku jest widoczna w PL", () => {
    const html = markup("button", { label_en: "Read more", href: "/x" });
    expect(html).toContain("Read more");
  });

  it("nav-link: etykieta tylko po angielsku jest widoczna w PL", () => {
    const html = markup("nav-link", { label_en: "About us", href: "/x" });
    expect(html).toContain("About us");
  });

  it("cta: tytuł, podtytuł i etykieta przycisku fallbackują na EN", () => {
    const html = markup("cta", {
      title_en: "Join us",
      subtitle_en: "It pays off",
      cta_en: "Sign up",
      href: "/x",
    });
    expect(html).toContain("Join us");
    expect(html).toContain("It pays off");
    expect(html).toContain("Sign up");
  });

  it("dark-featured-card: badge, tytuł i zajawka fallbackują na EN", () => {
    const html = markup("dark-featured-card", {
      badge_en: "Breaking",
      title_en: "Card title",
      excerpt_en: "Card excerpt",
    });
    expect(html).toContain("Breaking");
    expect(html).toContain("Card title");
    expect(html).toContain("Card excerpt");
  });

  it("text: HTML tylko po angielsku jest widoczny w PL", () => {
    const html = markup("text", { html_en: "<p>English paragraph</p>" });
    expect(html).toContain("English paragraph");
  });

  it("PL pozostaje nadrzędne wszędzie tam, gdzie istnieje", () => {
    const html = markup("heading", { text_pl: "Polski tytuł", text_en: "EN title" });
    expect(html).toContain("Polski tytuł");
    expect(html).not.toContain("EN title");
  });
});
