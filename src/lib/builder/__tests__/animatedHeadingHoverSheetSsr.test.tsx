// NAGŁÓWEK ANIMOWANY W TRYBIE HOVER: ARKUSZ EFEKTU JEDZIE Z HTML-EM SERWERA.
//
// Klasa `ah-as` (ramka allsides, `padding: 8px`) i `ah-hu` (podkreślenie)
// stoją w znacznikach nagłówka od pierwszego HTML-a, a ich arkusz był
// wstrzykiwany w `useEffect` - czyli dopiero po hydratacji. Nagłówek rósł wtedy
// o 16px już po wyświetleniu strony (przesunięcie układu wykryte przez test
// boot-home artefaktu produkcyjnego). Kontrakt: arkusz jest zasobem React 19
// (`<style href precedence>`) - jest w HTML-u serwera i trafia do `<head>`
// dokładnie raz, niezależnie od liczby nagłówków.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { AnimatedHeadingRender, type AnimatedHeadingConfig } from "../animatedHeadingVariants";

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-href^='ah-hover']").forEach((el) => el.remove());
});

function config(mode: AnimatedHeadingConfig["mode"]): AnimatedHeadingConfig {
  return { mode, textBefore: "Rozwijamy", highlight: "Europę", loop: false };
}

describe("AnimatedHeadingRender - arkusz efektu hover", () => {
  it.each([
    ["hover-allsides", "ah-hover-allsides-v1", "padding: 8px"],
    ["hover-underline", "ah-hover-line-v1", ".ah-hu"],
  ] as const)("%s: HTML serwera zawiera arkusz efektu", (mode, href, fragment) => {
    // NAPRAWIONE 2026-10-19: arkusz przychodził dopiero z `useEffect` klienta.
    const html = renderToString(<AnimatedHeadingRender config={config(mode)} />);
    expect(html).toContain(`data-href="${href}"`);
    expect(html).toContain(fragment);
  });

  it("dwa nagłówki dzielą jeden arkusz w <head>, a nie wstawiają go w <h2>", () => {
    const { container } = render(
      <>
        <AnimatedHeadingRender config={config("hover-allsides")} />
        <AnimatedHeadingRender config={config("hover-allsides")} />
      </>,
    );
    expect(document.head.querySelectorAll("style[data-href='ah-hover-allsides-v1']")).toHaveLength(
      1,
    );
    expect(container.querySelector("h2 style")).toBeNull();
  });

  it("tryb bez efektu hover nie dokłada arkusza", () => {
    const html = renderToString(<AnimatedHeadingRender config={config("highlight")} />);
    expect(html).not.toContain("ah-hover");
  });
});
