// Regresja: podgląd bloku cytatu w builderze musi renderować się 1:1 z
// publicznym rendererem (wariant, kolorystyka, klasy typografii, zawijanie),
// a warianty/kolorystyka mogą pojawiać się dopiero po kliknięciu bloku.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuoteBlock } from "../edit/Quote";
import { GenericWidgetToolbar } from "../GenericWidgetToolbar";
import { renderQuote } from "@/components/blocks/renderer/atoms";
import type { BlockRenderContext } from "@/components/blocks/renderer/context";
import type { Block } from "@/lib/blocks/types";

function quote(variant: string, palette = "neutral"): Block {
  return {
    id: "q1",
    type: "quote",
    data: {
      text: "Europa potrzebuje nowej strategii, a nie kolejnej deklaracji intencji.",
      cite: "Manifest NES",
      variant,
      colorPalette: palette,
    },
  } as Block;
}

const VARIANTS = ["default", "plain", "card", "minimal"] as const;

describe("Quote preview parity", () => {
  it.each(VARIANTS)("wariant %s ma ten sam layout w preview i publicznie", (variant) => {
    const block = quote(variant, "brand");

    const pub = render(
      <>
        {renderQuote({
          block,
          fnHtml: new Map<string, string>(),
          cls: "",
          lang: "pl",
          allBlocks: [block],
          t: ((k: string) => k) as unknown as BlockRenderContext["t"],
          renderChild: () => null,
        })}
      </>,
    );
    const pubQuote = pub.container.querySelector("blockquote");
    expect(pubQuote).not.toBeNull();
    const pubClasses = new Set((pubQuote?.className ?? "").split(/\s+/).filter(Boolean));
    pub.unmount();

    const prev = render(<QuoteBlock block={block} onChange={() => {}} />);
    const prevQuote = prev.container.querySelector("blockquote");
    expect(prevQuote).not.toBeNull();
    const prevClasses = new Set((prevQuote?.className ?? "").split(/\s+/).filter(Boolean));

    // Wariant identyfikowany tym samym atrybutem danych.
    expect(prevQuote?.getAttribute("data-quote-variant")).toBe(variant);
    expect(pubQuote?.getAttribute("data-quote-variant")).toBe(variant);

    // Wszystkie klasy layoutu (padding, border, space, wyrównanie) z publicznego
    // renderera muszą występować także w preview.
    for (const cls of pubClasses) {
      expect(prevClasses.has(cls), `brak klasy layoutu "${cls}" w preview`).toBe(true);
    }
    prev.unmount();
  });

  it("nie ucina treści: pole tekstu zawija się i rośnie z zawartością", () => {
    const { container } = render(<QuoteBlock block={quote("card")} onChange={() => {}} />);
    const ta = container.querySelector<HTMLTextAreaElement>('[data-quote-field="text"]');
    expect(ta).not.toBeNull();
    expect(ta?.className).toContain("break-words");
    expect(ta?.className).toContain("whitespace-pre-wrap");
    expect(ta?.className).toContain("max-w-full");
    // AutoGrowTextarea: brak scrolla, brak ręcznego resize - wysokość = treść.
    expect(ta?.style.overflow).toBe("hidden");
    expect(ta?.style.resize).toBe("none");
    expect(ta?.rows).toBe(1);
  });

  it("preview nie renderuje stałych kontrolek wariantu/kolorystyki", () => {
    const { container } = render(<QuoteBlock block={quote("default")} onChange={() => {}} />);
    expect(container.querySelectorAll("select")).toHaveLength(0);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Toolbar widgetu", () => {
  it("pokazuje kolorystykę dopiero w aktywnym toolbarze i nie ucina się", () => {
    const { container } = render(
      <GenericWidgetToolbar block={quote("default")} onChange={() => {}} />,
    );
    const bar = container.querySelector<HTMLElement>('[data-widget-toolbar="generic"]');
    expect(bar).not.toBeNull();
    // Responsywność: zawijanie zamiast poziomego ucinania, ograniczona szerokość.
    expect(bar?.className).toContain("flex-wrap");
    expect(bar?.className).toMatch(/max-w-\[min\(100%,calc\(100vw-1\.5rem\)\)\]/);
    // Nie nachodzi na treść - kotwiczony nad blokiem niezależnie od wysokości.
    expect(bar?.className).toContain("bottom-full");
    expect(bar?.className).not.toContain("-top-[38px]");
    // Kolorystyka dostępna tylko tutaj (toolbar renderowany wyłącznie dla
    // aktywnego bloku przez BlockCanvas).
    expect(screen.getByRole("button", { name: /kolorystyka/i })).toBeTruthy();
  });
});
