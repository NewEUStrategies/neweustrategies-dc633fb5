// Logo nagłówka chrome eager od `lg` (P3.2a, LP-6; decyzja orkiestratora:
// eager tylko wariant jasny).
//
// CO TU MA DOWÓD
//  * w `HeaderChromeContext` logo to `<picture class="contents">` ze źródłem
//    `data:` poniżej `lg` i `<img loading="eager">` BEZ `fetchpriority="high"`
//    i bez `data-lcp-candidate` (wysoki priorytet ma wyłącznie kandydat LCP);
//  * para light/dark: eager tylko jasny, ciemny leniwy i poza `<picture>`;
//  * poza kontekstem (stopka, treść) bez zmian: leniwe `<img>` bez `<picture>`;
//  * SSR: w zakresie `<picture>` React NIE emituje automatycznego preloadu, więc
//    `<head>` i licznik preloadów obrazów się nie zmieniają (kontrola: eager
//    `<img>` bez `<picture>` dostaje preload); hydratacja bez rozjazdu.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WidgetView } from "@/components/builder/organisms/WidgetView";
import { OptimizedImage } from "@/components/atoms/OptimizedImage";
import { HeaderChromeContext } from "@/lib/builder/headerChromeContext";
import type { WidgetContent, WidgetNode } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "not", "order", "range", "limit"]) b[m] = () => b;
  b.maybeSingle = async () => ({ data: null, error: null });
  b.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
  return { supabase: { from: () => b, rpc: async () => ({ data: [], error: null }) } };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
    i18n: { language: "pl" },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

afterEach(cleanup);

const LIGHT = "https://neweuropeanstrategies.com/media/logo.svg";
const DARK = "https://neweuropeanstrategies.com/media/logo-dark.svg";
const BLANK_GIF_PREFIX = "data:image/gif;base64,";

let nextId = 0;
function tree(content: WidgetContent, headerChrome: boolean): ReactElement {
  const node: WidgetNode = { id: `logo-${nextId++}`, kind: "widget", type: "image", content };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <HeaderChromeContext.Provider value={headerChrome}>
        <WidgetView node={node} lang="pl" device="desktop" editable={false} />
      </HeaderChromeContext.Provider>
    </QueryClientProvider>
  );
}

function ssrDom(ui: ReactElement): { html: string; host: HTMLElement } {
  const html = renderToString(ui);
  const host = document.createElement("div");
  host.innerHTML = html;
  return { html, host };
}

const imagePreloads = (html: string) =>
  html.match(/<link[^>]*rel="preload"[^>]*as="image"[^>]*>/g) ?? [];

describe("logo w nagłówku chrome (HeaderChromeContext)", () => {
  it("pojedyncze logo: eager w `<picture>` z pustym źródłem poniżej `lg`, bez high", () => {
    const { host } = ssrDom(tree({ src: LIGHT, alt_pl: "Logo" }, true));
    const picture = host.querySelector("picture");
    expect(picture?.className).toBe("contents");
    const source = picture?.querySelector("source");
    expect(source?.getAttribute("media")).toBe("(max-width: 1023px)");
    expect(source?.getAttribute("srcset")?.startsWith(BLANK_GIF_PREFIX)).toBe(true);
    const img = picture?.querySelector("img");
    expect(img?.getAttribute("loading")).toBe("eager");
    expect(img?.getAttribute("fetchpriority")).not.toBe("high");
    expect(img?.hasAttribute("data-lcp-candidate")).toBe(false);
    // SVG nie ma `srcset`, więc `sizes` (bez znaczenia bez `srcset`) nie trafia do HTML.
    expect(img?.hasAttribute("sizes")).toBe(false);
    expect(img?.getAttribute("src")).toBe(LIGHT);
  });

  it("para light/dark: eager tylko jasny (w `<picture>`), ciemny leniwy poza nim", () => {
    const { host } = ssrDom(tree({ src: LIGHT, srcDark: DARK, alt_pl: "Logo" }, true));
    const light = host.querySelector("img.gc-img-light");
    const dark = host.querySelector("img.gc-img-dark");
    expect(light?.getAttribute("loading")).toBe("eager");
    expect(light?.parentElement?.tagName).toBe("PICTURE");
    expect(dark?.getAttribute("loading")).toBe("lazy");
    expect(dark?.closest("picture")).toBeNull();
    expect(host.querySelectorAll("picture")).toHaveLength(1);
  });

  it("poza nagłówkiem chrome (stopka, treść): leniwe `<img>` bez `<picture>`", () => {
    const { host } = ssrDom(tree({ src: LIGHT, srcDark: DARK, alt_pl: "Logo" }, false));
    expect(host.querySelector("picture")).toBeNull();
    for (const img of host.querySelectorAll("img")) {
      expect(img.getAttribute("loading")).toBe("lazy");
    }
  });

  it("zwykły obraz w nagłówku chrome (nie logo) zostaje leniwy", () => {
    const { host } = ssrDom(tree({ src: "https://example.org/baner.png", alt_pl: "Baner" }, true));
    expect(host.querySelector("picture")).toBeNull();
    expect(host.querySelector("img")?.getAttribute("loading")).toBe("lazy");
  });

  it("SSR: logo w `<picture>` nie dostaje automatycznego preloadu (kontrola: bez `<picture>` dostaje)", () => {
    expect(imagePreloads(ssrDom(tree({ src: LIGHT, alt_pl: "Logo" }, true)).html)).toEqual([]);
    const control = renderToString(<OptimizedImage src={LIGHT} alt="Logo" eager />);
    expect(imagePreloads(control)).toHaveLength(1);
  });

  it("hydratacja HTML-u serwera bez rozjazdu", async () => {
    const ui = tree({ src: LIGHT, srcDark: DARK, alt_pl: "Logo" }, true);
    const host = document.createElement("div");
    host.innerHTML = renderToString(ui);
    document.body.append(host);
    const recoverable: unknown[] = [];
    const mismatches: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const text = args.map(String).join(" ");
      if (/hydrat|didn't match/i.test(text)) mismatches.push(text);
    });
    try {
      const root = hydrateRoot(host, ui, { onRecoverableError: (e) => recoverable.push(e) });
      await act(async () => {});
      await act(async () => root.unmount());
    } finally {
      spy.mockRestore();
      host.remove();
    }
    expect(recoverable).toEqual([]);
    expect(mismatches).toEqual([]);
  });
});
