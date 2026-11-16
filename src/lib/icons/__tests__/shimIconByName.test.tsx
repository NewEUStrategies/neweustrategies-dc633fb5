// `shimIconByName`: ikona shimu wybierana nazwą z treści CMS (D4, roadmapa §9.1).
//
// Co udowadniamy:
//   * LISTA NAZW I MAPA OGONA = PRZESTRZEŃ NAZW SHIMU (klucze w obie strony,
//     ten sam komponent pod kluczem) - inaczej nowy eksport shimu zapisany
//     w treści przestałby się rozwiązywać po cichu;
//   * ROZSTRZYGANIE JAK `Icons[name]` NA PRZESTRZENI NAZW: każdy własny
//     eksport daje ikonę o identycznym HTML, każda inna nazwa (1 703 nazwy
//     pickera, nazwy graniczne) daje `undefined`; klucze prototypu też
//     `undefined` (zamierzona różnica - w artefakcie wywracały render);
//   * ZESTAW SYNCHRONICZNY RENDERUJE SIĘ BEZ GRANICY SUSPENSE (HTML strumienia
//     bez zmian), ogon - w granicy, z tym samym SVG;
//   * GAŁĄŹ PRZEGLĄDARKI (leniwy chunk): hydratacja HTML-a serwera bez błędów
//     i bez zmiany DOM-u, a render czysto kliencki daje to samo SVG po
//     załadowaniu chunku.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { createRoot, hydrateRoot } from "react-dom/client";
import { act } from "react";
import * as ShimNamespace from "@/lib/lucide-shim";
import pickerIconNames from "@/lib/icons/iconNames.generated.json";
import { SHIM_ICON_NAMES } from "@/lib/icons/shimIconNames";
import { SHIM_ICONS } from "@/lib/icons/shimIconLongTail";
import { shimIconByName } from "@/lib/icons/shimIconByName";

const NAMESPACE = ShimNamespace as unknown as Record<string, ComponentType<object>>;
const NAMESPACE_KEYS = Object.keys(ShimNamespace).sort();
const PICKER_NAMES = (pickerIconNames as string[]).filter((k) => /^[a-z0-9-]+$/.test(k));
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);
const BOUNDARY = ["", " ", " Star", "Star ", "star", "STAR", "file-text", "Bell", "Flag", "x"];
const PROPS = { className: "w-4 h-4 shrink-0", size: 16, "aria-hidden": true };
// Nazwy, które treść realnie zawiera - muszą renderować się bez granicy.
const EAGER_NAMES = [
  "AlertTriangle",
  "ArrowRight",
  "Check",
  "Clock",
  "FileText",
  "Flame",
  "Info",
  "Mail",
  "Megaphone",
  "Send",
  "Sparkles",
  "Star",
];

function staticSvg(Icon: ComponentType<object>): string {
  return renderToStaticMarkup(createElement(Icon, PROPS));
}

describe("shimIconByName: rozstrzyganie nazw", () => {
  it("lista nazw jest równa kluczom przestrzeni nazw shimu", () => {
    expect([...SHIM_ICON_NAMES].sort()).toEqual(NAMESPACE_KEYS);
    expect(new Set(SHIM_ICON_NAMES).size).toBe(SHIM_ICON_NAMES.length);
  });

  it("mapa ogona ma te same klucze i te same komponenty co przestrzeń nazw shimu", () => {
    expect(Object.keys(SHIM_ICONS).sort()).toEqual(NAMESPACE_KEYS);
    for (const name of NAMESPACE_KEYS) expect(SHIM_ICONS[name], name).toBe(NAMESPACE[name]);
  });

  it("każdy eksport shimu daje ikonę o HTML identycznym z eksportem", () => {
    for (const name of NAMESPACE_KEYS) {
      const Icon = shimIconByName(name);
      expect(Icon, name).toBeDefined();
      expect(staticSvg(Icon as ComponentType<object>), name).toBe(staticSvg(NAMESPACE[name]));
    }
  });

  it("nazwy pickera (kebab-case), graniczne i klucze prototypu nie są ikonami", () => {
    const misses = [...PICKER_NAMES, ...BOUNDARY, ...PROTOTYPE_KEYS].filter(
      (n) => !Object.hasOwn(ShimNamespace, n),
    );
    expect(misses.length).toBeGreaterThan(1700);
    for (const name of misses) expect(shimIconByName(name), name).toBeUndefined();
  });

  it("zestaw synchroniczny to te same komponenty, renderowane bez granicy Suspense", () => {
    for (const name of EAGER_NAMES) {
      expect(shimIconByName(name), name).toBe(NAMESPACE[name]);
      const html = renderToString(
        createElement(shimIconByName(name) as ComponentType<object>, PROPS),
      );
      expect(html, name).not.toContain("<!--$");
    }
  });

  it("ogon renderuje to samo SVG w granicy Suspense, a komponent jest stały dla nazwy", () => {
    const Icon = shimIconByName("Trash2") as ComponentType<object>;
    expect(Icon).not.toBe(NAMESPACE.Trash2);
    expect(shimIconByName("Trash2")).toBe(Icon);
    const svg = staticSvg(NAMESPACE.Trash2);
    expect(renderToString(createElement(Icon, PROPS))).toBe(`<!--$-->${svg}<!--/$-->`);
  });
});

describe("shimIconByName: gałąź przeglądarki (leniwy ogon)", () => {
  afterEach(() => {
    vi.doUnmock("@tanstack/react-start");
    vi.resetModules();
    document.body.innerHTML = "";
  });

  // Kompilator Start zostawia w bundlu przeglądarki tylko `.client(...)`;
  // w testach (bez kompilatora) działa gałąź serwerowa, więc tu ją podmieniamy.
  async function loadClientResolver() {
    vi.resetModules();
    vi.doMock("@tanstack/react-start", () => ({
      createIsomorphicFn: () => ({
        server: () => ({ client: (impl: () => unknown) => impl }),
      }),
    }));
    return (await import("@/lib/icons/shimIconByName")).shimIconByName;
  }

  async function flushLazy() {
    await act(async () => {
      await import("@/lib/icons/shimIconLongTail");
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("hydratacja HTML-a serwera z ikoną z ogona: bez błędów i bez zmiany DOM-u", async () => {
    const tree = (Icon: ComponentType<object>) =>
      createElement("span", { className: "row" }, createElement(Icon, PROPS), "Etykieta");
    const serverHtml = renderToString(tree(shimIconByName("Trash2") as ComponentType<object>));
    expect(serverHtml).toContain("lucide-trash2");

    const clientResolve = await loadClientResolver();
    const container = document.createElement("div");
    container.innerHTML = serverHtml;
    document.body.appendChild(container);
    const recoverable: unknown[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, tree(clientResolve("Trash2") as ComponentType<object>), {
        onRecoverableError: (e) => recoverable.push(e),
      });
    });
    // Chunk jeszcze nie dojechał: HTML serwera zostaje na miejscu.
    expect(container.innerHTML).toBe(serverHtml);
    await flushLazy();
    expect(recoverable).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe(serverHtml);
    consoleError.mockRestore();
    act(() => root?.unmount());
  });

  it("render czysto kliencki rysuje to samo SVG po załadowaniu chunku", async () => {
    const clientResolve = await loadClientResolver();
    const Icon = clientResolve("Heading2") as ComponentType<object>;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(Icon, PROPS));
    });
    await flushLazy();
    expect(container.innerHTML).toBe(staticSvg(NAMESPACE.Heading2));
    act(() => root.unmount());
  });

  it("gałąź przeglądarki rozstrzyga te same nazwy co serwerowa", async () => {
    const clientResolve = await loadClientResolver();
    for (const name of [...NAMESPACE_KEYS, ...PICKER_NAMES.slice(0, 200), ...BOUNDARY]) {
      expect(clientResolve(name) === undefined, name).toBe(shimIconByName(name) === undefined);
    }
    for (const name of EAGER_NAMES) expect(clientResolve(name), name).toBe(NAMESPACE[name]);
  });
});
