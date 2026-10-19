// PUBLICZNY RENDERER: KOLOR TŁA I TEKSTU KOLUMNY W TRYBIE JASNYM I CIEMNYM.
//
// `ColumnProperties` zapisuje kolor w jednym z trzech kształtów: brak
// (dziedziczy), płaski string (oba tryby) albo `{ light, dark }` - ten ostatni
// powstaje, gdy redaktor nadpisze kolor tylko w jednym trybie. Do 2026-10-19
// renderer wkładał wartość surowo do `style`, więc obiekt trybów przepadał
// (kolor znikał w OBU trybach), a płaski string z bazy szedł do atrybutu bez
// żadnej walidacji. Kontrakt: tryby jadą zmiennymi inline (`--nes-col-bg` /
// `--nes-col-bg-dark`), a o wyborze decyduje reguła `.dark` arkusza; każda
// wartość przechodzi przez wspólny whitelist `safeWidgetColor`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import "@/test/i18nReal";
import { __resetBuilderDebugForTests } from "@/lib/builder/builderDebug";
import type { BuilderDocument, ColumnNode } from "@/lib/builder/types";
import { BuilderRenderer } from "../BuilderRenderer";
import { column, doc, section, stubObservers, widget } from "./builderRendererFixtures";

vi.mock(
  "@/components/builder/organisms/widget-view/lazyWidgets",
  () => import("@/test/eagerWidgetChunks"),
);

let observers: ReturnType<typeof stubObservers>;

beforeEach(() => {
  observers = stubObservers();
  __resetBuilderDebugForTests();
});

afterEach(() => {
  cleanup();
  observers.restore();
  document.body.innerHTML = "";
});

/** Sama kolumna - slot siatki nad nią nosi ten sam `data-col-id`. */
const KOLUMNA = '[data-col-id="c1"]:not([data-column-slot])';

function dokument(style: unknown): BuilderDocument {
  return doc([section("s1", [column("c1", [widget("w1")], { style } as Partial<ColumnNode>)])]);
}

function kolumna(style: unknown): HTMLElement {
  const el = renderWithQueryClient(
    <BuilderRenderer doc={dokument(style)} lang="pl" />,
  ).container.querySelector<HTMLElement>(KOLUMNA);
  if (!el) throw new Error("test: brak kolumny c1");
  return el;
}

describe("BuilderRenderer - kolor kolumny", () => {
  it("płaski kolor obowiązuje w obu trybach jako deklaracja inline", () => {
    const el = kolumna({ bgColor: "#112233", textColor: "rgba(255, 255, 255, 0.9)" });
    expect(el.style.background).toContain("#112233");
    expect(el.style.color).toBe("rgba(255, 255, 255, 0.9)");
    expect(el.hasAttribute("data-col-bg")).toBe(false);
  });

  it.each([
    ["wyjście z deklaracji", "red;position:fixed"],
    ["url()", "url(https://zly.example/x.png)"],
    ["expression()", "expression(alert(1))"],
  ])("zapis spoza whitelisty nie trafia do stylu: %s", (_l, wartosc) => {
    const el = kolumna({ bgColor: wartosc, textColor: wartosc });
    expect(el.style.background).toBe("");
    expect(el.style.color).toBe("");
    expect(el.getAttribute("style") ?? "").not.toMatch(/position|url\(|expression/);
  });

  it("nadpisanie per tryb daje oba kolory zamiast zgubionego obiektu", () => {
    const el = kolumna({
      bgColor: { light: "#ffffff", dark: "#0b1020" },
      textColor: { light: "#111111", dark: "#f5f5f5" },
    });
    expect(el.style.getPropertyValue("--nes-col-bg")).toBe("#ffffff");
    expect(el.style.getPropertyValue("--nes-col-bg-dark")).toBe("#0b1020");
    expect(el.style.getPropertyValue("--nes-col-fg")).toBe("#111111");
    expect(el.style.getPropertyValue("--nes-col-fg-dark")).toBe("#f5f5f5");
    // Reguła `.dark` arkusza czyta zmienne tylko z oznaczonej kolumny, a
    // deklaracja inline jej nie przykrywa.
    expect(el.hasAttribute("data-col-bg")).toBe(true);
    expect(el.hasAttribute("data-col-fg")).toBe(true);
    expect(el.style.background).toBe("");
    expect(el.getAttribute("style") ?? "").not.toContain("[object Object]");
  });

  it("nadpisany tylko jeden tryb: drugi bierze tę samą wartość, jak podgląd panelu", () => {
    const el = kolumna({ bgColor: { dark: "#0b1020" } });
    expect(el.style.getPropertyValue("--nes-col-bg")).toBe("#0b1020");
    expect(el.style.getPropertyValue("--nes-col-bg-dark")).toBe("#0b1020");
  });

  it("niebezpieczna wartość jednego trybu odpada, bezpieczna zostaje dla obu", () => {
    const el = kolumna({ bgColor: { light: "url(x)", dark: "#0b1020" } });
    expect(el.style.getPropertyValue("--nes-col-bg")).toBe("#0b1020");
    expect(el.getAttribute("style") ?? "").not.toContain("url(");
  });

  it("obiekt trybów bez żadnego poprawnego koloru nie oznacza kolumny", () => {
    const el = kolumna({ bgColor: { light: "url(x)", dark: "" } });
    expect(el.hasAttribute("data-col-bg")).toBe(false);
    expect(el.style.getPropertyValue("--nes-col-bg")).toBe("");
  });

  it("HTML serwera niesie oba tryby, zanim ruszy JS", () => {
    const html = renderToString(
      <QueryClientProvider client={new QueryClient()}>
        <BuilderRenderer
          doc={dokument({ bgColor: { light: "#ffffff", dark: "#0b1020" } })}
          lang="pl"
        />
      </QueryClientProvider>,
    );
    const host = document.createElement("div");
    host.innerHTML = html;
    const el = host.querySelector<HTMLElement>(KOLUMNA);
    expect(el?.hasAttribute("data-col-bg")).toBe(true);
    expect(el?.style.getPropertyValue("--nes-col-bg-dark")).toBe("#0b1020");
  });
});
