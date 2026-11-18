// Etykieta sekcji a hierarchia nagłówków (Nu Html Checker, „heading-order").
//
// Tytuły kart pod etykietą to `h3`, strona ma jeden `h1`. Walidator HTML liczy
// wyłącznie natywne h1-h6, więc tytuł etykiety jest `h2` (dawniej
// `span role="heading"`: raport „h3 po h1" i „sekcja bez nagłówka"). Wygląd
// zostaje: klasa `cms-sl` wyłącza tytuł z typografii nagłówków (reguły pilnuje
// `sectionLabelHeadingCss.test.ts`), opakowania frazowe stają się `div`
// (`h2` w `span` to błąd treści), a tytuł z kontekstu liniowego dostaje `inline`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import {
  SECTION_LABEL_VARIANTS,
  SectionLabelRender,
  type SectionLabelVariant,
} from "@/lib/builder/sectionLabelVariants";

afterEach(cleanup);

const VARIANTS = SECTION_LABEL_VARIANTS.map((v) => v.value);

/** Warianty, w których tytuł był `div` (blok) - `h2` też jest blokiem. */
const BLOCK_TITLE = new Set(["double-deck-masthead", "stacked-serif-lede", "numbered-rail"]);

/** Warianty, w których tytuł stał w linii opakowania (nie jako element flex). */
const INLINE_TITLE = new Set(["small-corners", "only-text", "underline-sweep"]);

/** Przodkowie dopuszczający wyłącznie treść frazową - `h2` w nich to błąd walidatora. */
const PHRASING_ONLY = "span, a, button, label, p, em, strong, small, b, i, q, cite, time";

const renderLabel = (variant: SectionLabelVariant, extra: Record<string, unknown> = {}) =>
  render(
    <SectionLabelRender
      label="Najnowszy raport"
      action="Więcej"
      category="Kategoria"
      accent="#FA9346"
      variant={variant}
      {...extra}
    />,
  );

describe("Etykieta sekcji - natywny h2", () => {
  it.each(VARIANTS)("wariant %s: dokładnie jeden h2 z tytułem, bez roli ARIA", (variant) => {
    const { container } = renderLabel(variant);
    const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6");
    expect(headings).toHaveLength(1);
    const h2 = headings[0] as HTMLElement;
    expect(h2.tagName).toBe("H2");
    expect(h2.hasAttribute("data-title-root")).toBe(true);
    expect(h2.classList.contains("cms-sl")).toBe(true);
    expect(h2.textContent).toBe("Najnowszy raport");
    expect(h2.hasAttribute("role")).toBe(false);
    expect(h2.hasAttribute("aria-level")).toBe(false);
    expect(container.querySelector('[role="heading"]')).toBeNull();
  });

  it.each(VARIANTS)("wariant %s: h2 nie stoi w elemencie frazowym", (variant) => {
    const { container } = renderLabel(variant);
    const h2 = container.querySelector("h2")!;
    expect(h2.parentElement?.closest(PHRASING_ONLY)).toBeNull();
  });

  it.each(VARIANTS)("wariant %s: h2 ma display dawnego tytułu", (variant) => {
    const { container } = renderLabel(variant);
    const h2 = container.querySelector("h2")!;
    const parent = h2.parentElement!;
    const parentIsFlex = /(^|\s)(inline-)?flex(\s|$)/.test(parent.className);
    if (INLINE_TITLE.has(variant)) {
      // Tytuł w linii opakowania: wysokość wiersza liczy rozpórka rodzica.
      expect(parentIsFlex).toBe(false);
      expect(h2.classList.contains("inline")).toBe(true);
      return;
    }
    // Element flex (blokowany jak `span`), jawna klasa `display` albo dawny `div`.
    const explicitDisplay = /(^|\s)(inline|inline-block|block)(\s|$)/.test(h2.className);
    expect(parentIsFlex || explicitDisplay || BLOCK_TITLE.has(variant)).toBe(true);
  });

  it("miniatura panelu (sm) zostaje span/div bez h2 i bez cms-sl", () => {
    for (const variant of VARIANTS) {
      const { container, unmount } = renderLabel(variant, { size: "sm" });
      expect(container.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")).toBeNull();
      const title = container.querySelector<HTMLElement>("[data-title-root]")!;
      expect(["SPAN", "DIV"]).toContain(title.tagName);
      expect(title.classList.contains("cms-sl")).toBe(false);
      expect(container.querySelector(".cms-sl")).toBeNull();
      unmount();
    }
  });

  it("pusta etykieta nie zostawia pustego nagłówka", () => {
    for (const variant of VARIANTS) {
      const { container, unmount } = renderLabel(variant, { label: "" });
      expect(container.querySelector("h2, [role='heading']")).toBeNull();
      unmount();
    }
  });

  it("HTML z serwera ma ten sam h2 i te same opakowania co render klienta", () => {
    const tagPath = (el: Element | null, root: Element) => {
      const tags: string[] = [];
      for (let node = el; node && node !== root; node = node.parentElement) tags.push(node.tagName);
      return tags.join("<");
    };
    for (const variant of VARIANTS) {
      const element = (
        <SectionLabelRender label="Najnowszy raport" accent="#FA9346" variant={variant} />
      );
      const ssr = document.createElement("div");
      ssr.innerHTML = renderToString(element);
      const { container, unmount } = render(element);
      const ssrH2 = ssr.querySelector("h2");
      const clientH2 = container.querySelector("h2");
      const snapshot = (h: HTMLElement | null) => [
        h?.className,
        h?.getAttribute("data-title-root"),
        h?.style.cssText,
        h?.textContent,
      ];
      expect(snapshot(ssrH2)).toEqual(snapshot(clientH2));
      expect(tagPath(ssrH2, ssr)).toBe(tagPath(clientH2, container));
      unmount();
    }
  });
});

describe("Etykieta sekcji - światło tytułu po zmianie opakowania span -> div", () => {
  // `badge-filled`/`slanted-ribbon-rule`: tytuł dziedziczył `tracking-wider`
  // (em OPAKOWANIA), a `span` opakowania brał rozmiar ogólny typografii widgetu
  // (`[data-wt~="fs"]`). `div` już go nie bierze, więc tytuł liczy światło sam,
  // gdy `--wt-fs` istnieje; bez `fs` deklaracja jest nieważna i światło
  // dziedziczy jak dawniej. Usunięcie tej kompensacji zmieniłoby wygląd.
  const COMPENSATED = new Set(["badge-filled", "slanted-ribbon-rule"]);
  const FS_TRACKING = "calc(var(--tracking-wider) + 0*var(--wt-fs))";

  // HTML z serwera, bo to on niesie styl do przeglądarki - happy-dom odrzuca
  // `calc(var(...))` przy parsowaniu `style` w renderze klienckim.
  const ssrTitle = (variant: string, extra: Record<string, unknown> = {}) => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <SectionLabelRender
        label="Najnowszy raport"
        accent="#FA9346"
        variant={variant as SectionLabelVariant}
        {...extra}
      />,
    );
    return host.querySelector<HTMLElement>("[data-title-root]");
  };
  const styleAttr = (el: HTMLElement | null) =>
    (el?.getAttribute("style") ?? "").replace(/\s+/g, "");

  it.each([...COMPENSATED])("wariant %s: h2 niesie kompensację światła", (variant) => {
    const h2 = ssrTitle(variant);
    expect(h2?.tagName).toBe("H2");
    expect(styleAttr(h2)).toContain(`letter-spacing:${FS_TRACKING.replace(/\s+/g, "")}`);
    // Bez `fs` światło dziedziczy z opakowania - ono musi nieść `tracking-wider`.
    expect(h2?.parentElement?.tagName).toBe("DIV");
    expect(h2?.parentElement?.classList.contains("tracking-wider")).toBe(true);
  });

  it.each([...COMPENSATED])("wariant %s: rozmiar sm (span) bez kompensacji", (variant) => {
    const title = ssrTitle(variant, { size: "sm" });
    expect(title?.tagName).toBe("SPAN");
    expect(styleAttr(title)).not.toContain("letter-spacing");
  });

  it("pozostałe warianty nie dostają kompensacji światła", () => {
    for (const variant of VARIANTS) {
      if (COMPENSATED.has(variant)) continue;
      expect(styleAttr(ssrTitle(variant)), variant).not.toContain("0*var(--wt-fs)");
    }
  });
});
