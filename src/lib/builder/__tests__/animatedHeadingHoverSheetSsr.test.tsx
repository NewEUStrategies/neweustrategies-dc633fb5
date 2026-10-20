// NAGŁÓWEK ANIMOWANY W TRYBIE HOVER: GEOMETRIA W HTML-U SERWERA, ARKUSZ PO HYDRATACJI.
//
// Klasy `ah-as` (ramka allsides) i `ah-hu` (podkreślenie) stoją w znacznikach
// nagłówka od pierwszego HTML-a. Gdy odstęp ramki (8px) przychodził z arkuszem
// wstrzykiwanym po hydratacji, nagłówek rósł o 16px już po wyświetleniu strony
// (przesunięcie układu wykryte przez test boot-home artefaktu produkcyjnego).
// Arkusz efektu w HTML-u serwera (5c5f4d251) usuwał przesunięcie, ale przewracał
// bramkę wagi dokumentu `/` (first-visit.yml: 6,5 KB w `<head>`, komentarze CSS).
// Kontrakt:
//  * HTML serwera niesie GEOMETRIĘ w atrybucie `style` segmentu (8px ramki,
//    1px pod podkreśleniem) i NIE niesie arkusza efektu;
//  * hydratacja tego HTML-a przechodzi bez rozjazdu, a po niej arkusz jest
//    zasobem React 19 (`<style href precedence>`) w `<head>` - dokładnie raz,
//    niezależnie od liczby nagłówków, nigdy wewnątrz `<h*>`.
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";

import { AnimatedHeadingRender, type AnimatedHeadingConfig } from "../animatedHeadingVariants";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/**
 * Świeży dokument (ramka) na test: React pamięta wstawione zasoby `<style href>` per dokument,
 * więc węzeł usunięty ręcznie z `document.head` nie wróciłby w kolejnym teście - każdy test
 * klienta dostaje własny `<head>` i własną pamięć zasobów.
 */
function freshDocument(): { doc: Document; host: HTMLDivElement } {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  const host = doc.createElement("div");
  doc.body.appendChild(host);
  return { doc, host };
}

function config(mode: AnimatedHeadingConfig["mode"]): AnimatedHeadingConfig {
  return { mode, textBefore: "Rozwijamy", highlight: "Europę", loop: false };
}

const HOVER_CASES = [
  ["hover-allsides", "ah-hover-allsides-v1", "ah-as allsides-1", "padding:8px"],
  ["hover-underline", "ah-hover-line-v1", "ah-hu ah-hu-1", "padding:0 0 1px"],
] as const;

describe("AnimatedHeadingRender - efekt hover", () => {
  it.each(HOVER_CASES)(
    "%s: HTML serwera niesie geometrię segmentu, bez arkusza efektu",
    (mode, href, className, padding) => {
      const html = renderToString(<AnimatedHeadingRender config={config(mode)} />);
      const host = document.createElement("div");
      host.innerHTML = html;
      const segment = host.querySelector<HTMLElement>(`span[class="${className}"]`);
      expect(segment).not.toBeNull();
      // Odstęp w atrybucie `style` od pierwszego HTML-a - bez niego segment
      // rósłby po dojściu arkusza (CLS).
      expect(segment!.getAttribute("style")).toContain(padding);
      expect(segment!.getAttribute("style")).toContain("display:inline-block");
      // Waga dokumentu: arkusz efektu nie jedzie z HTML-em serwera.
      expect(html).not.toContain(`data-href="${href}"`);
      expect(html).not.toContain("<style");
    },
  );

  it.each(HOVER_CASES)(
    "%s: hydratacja HTML-a serwera bez rozjazdu, potem arkusz w <head>",
    async (mode, href) => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const recoverable: unknown[] = [];
      const { doc, host } = freshDocument();
      host.innerHTML = renderToString(<AnimatedHeadingRender config={config(mode)} />);
      const before = host.innerHTML;
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(host, <AnimatedHeadingRender config={config(mode)} />, {
          onRecoverableError: (error) => recoverable.push(error),
        });
      });
      expect(recoverable).toEqual([]);
      expect(errors).not.toHaveBeenCalled();
      // Znaczniki nagłówka po hydratacji bez zmian (ta sama geometria).
      expect(host.innerHTML).toBe(before);
      expect(doc.head.querySelectorAll(`style[data-href='${href}']`)).toHaveLength(1);
      await act(async () => root?.unmount());
    },
  );

  it("dwa nagłówki dzielą jeden arkusz w <head>, a nie wstawiają go w <h2>", () => {
    const { doc, host } = freshDocument();
    const { container } = render(
      <>
        <AnimatedHeadingRender config={config("hover-allsides")} />
        <AnimatedHeadingRender config={config("hover-allsides")} />
      </>,
      { container: host, baseElement: doc.body },
    );
    expect(doc.head.querySelectorAll("style[data-href='ah-hover-allsides-v1']")).toHaveLength(1);
    expect(container.querySelector("h2 style")).toBeNull();
  });

  it("tryb bez efektu hover nie dokłada ani arkusza, ani odstępu", () => {
    const html = renderToString(<AnimatedHeadingRender config={config("highlight")} />);
    expect(html).not.toContain("ah-hover");
    expect(html).not.toContain("padding:8px");
    const { doc, host } = freshDocument();
    render(<AnimatedHeadingRender config={config("highlight")} />, {
      container: host,
      baseElement: doc.body,
    });
    expect(doc.head.querySelector("style[data-href^='ah-hover']")).toBeNull();
  });
});
