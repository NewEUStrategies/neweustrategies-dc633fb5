// Kontrakt skoków marker <-> sekcja przypisów na poziomie samych funkcji.
//
// Test komponentu (`components/__tests__/footnoteNavigation.test.tsx`) dowodzi
// tylko, że klik w ogóle PRZEWIJA. Tu leżą reguły, których tamten nie widzi:
// offset pod sticky header, `prefers-reduced-motion`, fokus dla czytnika
// ekranu, odsiew obcych kotwic - oraz stan wpisu historii, który należy do
// routera. Do tej naprawy `replaceState(null, …)` kasował `__TSR_key`
// i `__TSR_index` TanStacka: przywracanie scrolla po powrocie na wpis
// dostawało losowy klucz, a kierunek nawigacji liczył się od zera.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFootnoteTargetId, scrollToFootnoteId } from "../navigation";

const scrollTo = vi.fn();

function stubMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** Cel skoku z kontrolowaną pozycją w oknie. */
function mountTarget(id: string, viewportTop: number, attrs: Record<string, string> = {}) {
  const el = document.createElement("li");
  el.id = id;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(new DOMRect(0, viewportTop, 600, 40));
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  scrollTo.mockReset();
  vi.stubGlobal("scrollTo", scrollTo);
  vi.stubGlobal("scrollY", 1000);
  stubMotion(false);
  window.history.replaceState(null, "", "/wpis/analiza");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("scrollToFootnoteId", () => {
  it("przewija płynnie z offsetem pod sticky header i ustawia fokus bez skoku", () => {
    const target = mountTarget("fn-2", 400);
    const focus = vi.spyOn(target, "focus");

    expect(scrollToFootnoteId("fn-2")).toBe(true);

    // 400 (w oknie) + 1000 (przewinięte) - 112 (header + oddech)
    expect(scrollTo).toHaveBeenCalledWith({ top: 1288, behavior: "smooth" });
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(document.activeElement).toBe(target);
  });

  it("przy prefers-reduced-motion skacze natychmiast i nie schodzi poniżej zera", () => {
    stubMotion(true);
    vi.stubGlobal("scrollY", 0);
    mountTarget("fnref-1", 40);

    expect(scrollToFootnoteId("fnref-1")).toBe(true);

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(window.location.hash).toBe("#fnref-1");
  });

  it("nie nadpisuje tabindex, który cel już ma", () => {
    const target = mountTarget("fn-3", 200, { tabindex: "0" });

    scrollToFootnoteId("fn-3");

    expect(target.getAttribute("tabindex")).toBe("0");
    expect(document.activeElement).toBe(target);
  });

  it("zmienia hash, ZACHOWUJĄC stan wpisu historii należący do routera", () => {
    const routerState = { __TSR_index: 4, __TSR_key: "k9x2", key: "k9x2" };
    window.history.replaceState(routerState, "", "/wpis/analiza?lang=pl");
    mountTarget("fn-1", 300);

    scrollToFootnoteId("fn-1");

    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      "/wpis/analiza?lang=pl#fn-1",
    );
    expect(window.history.state).toEqual(routerState);
  });

  it("zablokowany replaceState (piaskownica) nie odbiera skoku", () => {
    mountTarget("fn-4", 300);
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });

    expect(scrollToFootnoteId("fn-4")).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("bez celu w DOM zwraca false i niczego nie rusza - zostaje natywna kotwica", () => {
    expect(scrollToFootnoteId("fn-99")).toBe(false);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });

  it("na serwerze (bez document) zwraca false zamiast rzucać", () => {
    vi.stubGlobal("document", undefined);

    expect(() => scrollToFootnoteId("fn-1")).not.toThrow();
    expect(scrollToFootnoteId("fn-1")).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});

describe("resolveFootnoteTargetId", () => {
  function anchor(href: string, inner = "[1]"): HTMLAnchorElement {
    const a = document.createElement("a");
    a.setAttribute("href", href);
    a.innerHTML = `<span>${inner}</span>`;
    document.body.appendChild(a);
    return a;
  }

  it("rozpoznaje marker w treści i backlink z sekcji, także po kliku w dziecko", () => {
    const marker = anchor("#fn-12");
    const backlink = anchor("#fnref-3", "↩");

    expect(resolveFootnoteTargetId(marker)).toBe("fn-12");
    expect(resolveFootnoteTargetId(marker.querySelector("span"))).toBe("fn-12");
    expect(resolveFootnoteTargetId(backlink.querySelector("span"))).toBe("fnref-3");
  });

  it("odrzuca kotwice o nienumerycznym celu i zwykłe linki", () => {
    const plain = anchor("#sekcja-2");
    const named = anchor("#fn-intro");
    const suffixed = anchor("#fn-1x");

    expect(resolveFootnoteTargetId(plain)).toBeNull();
    expect(resolveFootnoteTargetId(named)).toBeNull();
    expect(resolveFootnoteTargetId(suffixed)).toBeNull();
  });

  it("klik poza odsyłaczem i brak celu zdarzenia dają null", () => {
    const paragraph = document.createElement("p");
    paragraph.innerHTML = '<a href="https://example.org/#fn-1">obcy link</a>';
    document.body.appendChild(paragraph);

    expect(resolveFootnoteTargetId(paragraph)).toBeNull();
    // Kotwica z `#fn-` w ŚRODKU adresu to link zewnętrzny, nie przypis.
    expect(resolveFootnoteTargetId(paragraph.querySelector("a"))).toBeNull();
    expect(resolveFootnoteTargetId(null)).toBeNull();
  });
});
