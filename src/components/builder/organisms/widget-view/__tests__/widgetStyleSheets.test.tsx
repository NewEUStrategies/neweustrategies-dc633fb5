// F22: stałe arkusze widgetów jako zasoby React 19 (`<style href precedence>`).
//
// Kontrakt przypięty tym testem:
//   1. Trzy instancje tego samego widgetu emitują arkusz STAŁY dokładnie RAZ
//      (React dedupikuje po `href`).
//   2. Arkusz stały ląduje w `<head>`, a arkusze instancji zostają w `<body>` -
//      czyli w dokumencie PO nim. Przy równej specyficzności wygrywa instancja,
//      co jest całą pointą podziału (stałe w jednej warstwie, zmienne lokalnie).
//   3. Nazwa `href` jest stabilna między renderami, więc arkusz nie rozmnaża się
//      po nawigacji klienckiej.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WidgetStyleSheet,
  WIDGET_SHEET_PRECEDENCE,
} from "@/components/builder/organisms/widget-view/widgetStyleSheets";

const SHEET = ".nes-probe{color:red;}";

afterEach(cleanup);

// Zasoby hoistowane przeżywają odmontowanie komponentu (taki jest ich sens),
// a React pamięta już wstawione `href` na czas życia dokumentu - usunięcie
// węzła z <head> NIE resetuje tej pamięci. Każdy przypadek dostaje więc własny
// klucz zamiast sprzątania po poprzednim.

describe("WidgetStyleSheet - deduplikacja stałych arkuszy", () => {
  it("trzy instancje tego samego widgetu dają JEDEN arkusz w dokumencie", () => {
    render(
      <div>
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
      </div>,
    );
    const sheets = Array.from(document.querySelectorAll("style")).filter((el) =>
      el.innerHTML.includes(".nes-probe"),
    );
    expect(sheets).toHaveLength(1);
  });

  it("arkusz stały trafia do <head> z jedną warstwą precedencji", () => {
    render(<WidgetStyleSheet name="nes-probe-head" css={SHEET} />);
    const sheet = document.head.querySelector("style[data-href='nes-probe-head']");
    expect(sheet).not.toBeNull();
    expect(sheet?.getAttribute("data-precedence")).toBe(WIDGET_SHEET_PRECEDENCE);
  });

  it("styl instancji stoi w dokumencie PO arkuszu stałym", () => {
    const { container } = render(
      <div>
        <WidgetStyleSheet name="nes-probe-order" css={SHEET} />
        <style data-instance>{".nes-probe{color:blue;}"}</style>
      </div>,
    );
    const hoisted = document.head.querySelector("style[data-href='nes-probe-order']");
    const instance = container.querySelector("style[data-instance]");
    expect(hoisted).not.toBeNull();
    expect(instance).not.toBeNull();
    // DOCUMENT_POSITION_FOLLOWING = instancja jest PO arkuszu stałym.
    expect(
      hoisted!.compareDocumentPosition(instance!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("SSR wypisuje treść arkusza raz, mimo trzech instancji", () => {
    const html = renderToStaticMarkup(
      <div>
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
        <WidgetStyleSheet name="nes-probe-dedupe" css={SHEET} />
      </div>,
    );
    expect(html.split(".nes-probe{color:red;}").length - 1).toBe(1);
  });
});
