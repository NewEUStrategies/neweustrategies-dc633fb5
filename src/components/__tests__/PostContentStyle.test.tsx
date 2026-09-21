/**
 * <PostContentStyle /> - jedyny most między panelem „Układ wpisu" a wyglądem
 * treści artykułu: komponent nic nie renderuje, tylko SKŁADA ARKUSZ i wstawia
 * go do <head> pod stałym identyfikatorem.
 *
 * CO TEN PLIK PRZYPINA (i dlaczego akurat to). Skoro jedynym wyjściem tego
 * komponentu jest tekst CSS, to asercje idą na WYGENEROWANE WARTOŚCI, nie na
 * obecność węzła <style> (obecność przechodziłaby także wtedy, gdyby arkusz był
 * pusty albo pochodził z domyślnych ustawień zamiast z panelu):
 *  1. brak wczytanych ustawień = BRAK arkusza (nie pusty arkusz - inaczej
 *     pierwszy paint kasowałby kaskadę motywu),
 *  2. kolory linku osobno dla jasnego i ciemnego motywu (dwie reguły),
 *  3. cztery warianty kroju linku i pięć wariantów punktora listy, w tym
 *     spadek nieznanej wartości na `disc`,
 *  4. przełącznik podkreślenia (`underline` vs `none`),
 *  5. szerokość figury „wide" przenoszona z ustawień w pikselach,
 *  6. opcjonalna ramka podpisu obrazu - reguła ma się POJAWIAĆ i ZNIKAĆ,
 *  7. AKTUALIZACJA W MIEJSCU: zmiana ustawień nadpisuje treść tego samego
 *     węzła zamiast doklejać kolejne arkusze do <head>.
 *
 * CO JEST ZAATRAPOWANE: `@/hooks/usePostLayoutSettings` - granica danych
 * (hook robi round-trip do `post_layout_settings`). Wartości budujemy z
 * PRAWDZIWEGO `defaultPostLayoutSettings()`, więc test nie trzyma własnej kopii
 * kształtu ustawień.
 *
 * ŚWIADOMIE POZA ZAKRESEM: kaskada CSS (happy-dom nie liczy stylów) - mierzymy
 * tekst reguł, bo to jest kontrakt tego komponentu.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";

const h = vi.hoisted(() => ({ settings: null as PostLayoutSettings | null }));

vi.mock("@/hooks/usePostLayoutSettings", () => ({
  usePostLayoutSettings: () => ({ data: h.settings }),
}));

import { PostContentStyle } from "@/components/PostContentStyle";

const STYLE_ID = "nes-post-content-style";

function settings(over: Partial<PostLayoutSettings> = {}): PostLayoutSettings {
  return { ...defaultPostLayoutSettings(), ...over };
}

function styleEl(): HTMLStyleElement | null {
  return document.getElementById(STYLE_ID) as HTMLStyleElement | null;
}

/** Treść jednej reguły (bez selektora) - żeby asercja nie łapała sąsiadów. */
function rule(selector: string): string {
  const css = styleEl()?.textContent ?? "";
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close).trim();
}

function renderStyle(over: Partial<PostLayoutSettings> = {}) {
  h.settings = settings(over);
  return render(<PostContentStyle />);
}

beforeEach(() => {
  h.settings = null;
});

afterEach(() => {
  cleanup();
  // Komponent celowo NIE sprząta arkusza przy odmontowaniu (globalny styl
  // strony), więc robi to test - inaczej węzeł przeciekałby między przypadkami.
  styleEl()?.remove();
});

describe("PostContentStyle - arkusz treści wpisu", () => {
  it("bez wczytanych ustawień nie wstawia arkusza do <head>", () => {
    h.settings = null;
    const { container } = render(<PostContentStyle />);

    expect(container).toBeEmptyDOMElement();
    expect(styleEl()).toBeNull();
  });

  it("kolory linku trafiają osobno do reguły jasnej i ciemnej", () => {
    renderStyle({
      hyperlink_color: "#123456",
      hyperlink_color_dark: "#abcdef",
      underline_color: "#222222",
      underline_color_dark: "#eeeeee",
    });

    const light = rule(".single-post-content a");
    expect(light).toContain("color: #123456;");
    expect(light).toContain("text-decoration-color: #222222;");
    expect(light).not.toContain("#abcdef");

    const dark = rule(".dark .single-post-content a");
    expect(dark).toContain("color: #abcdef;");
    expect(dark).toContain("text-decoration-color: #eeeeee;");
  });

  it("bez ustawionych kolorów reguła linku nie deklaruje koloru wcale", () => {
    renderStyle({
      hyperlink_color: null,
      hyperlink_color_dark: null,
      underline_color: null,
      underline_color_dark: null,
    });

    expect(rule(".single-post-content a")).not.toContain("color:");
    expect(rule(".dark .single-post-content a")).toBe("");
  });

  it("krój linku ma cztery warianty, a nieznany nie dokłada żadnej deklaracji", () => {
    const bold = renderStyle({ hyperlink_style: "bold" });
    expect(rule(".single-post-content a")).toContain("font-weight:600;");
    bold.unmount();
    styleEl()?.remove();

    const italic = renderStyle({ hyperlink_style: "italic" });
    expect(rule(".single-post-content a")).toContain("font-style:italic;");
    expect(rule(".single-post-content a")).not.toContain("font-weight");
    italic.unmount();
    styleEl()?.remove();

    const both = renderStyle({ hyperlink_style: "bold-italic" });
    expect(rule(".single-post-content a")).toContain("font-weight:600;font-style:italic;");
    both.unmount();
    styleEl()?.remove();

    renderStyle({ hyperlink_style: "regular" });
    const plain = rule(".single-post-content a");
    expect(plain).not.toContain("font-weight");
    expect(plain).not.toContain("font-style");
  });

  it("przełącznik podkreślenia wybiera między underline a none", () => {
    const on = renderStyle({ hyperlink_underline: true });
    expect(rule(".single-post-content a")).toContain("text-decoration: underline;");
    on.unmount();
    styleEl()?.remove();

    renderStyle({ hyperlink_underline: false });
    expect(rule(".single-post-content a")).toContain("text-decoration: none;");
  });

  it("punktor listy przenosi wartość z panelu, a nieznaną zamienia na disc", () => {
    for (const value of ["circle", "square", "disc", "none"]) {
      const view = renderStyle({ list_style: value });
      expect(rule(".single-post-content ul:not(.cms-content-list)")).toContain(
        `list-style: ${value};`,
      );
      view.unmount();
      styleEl()?.remove();
    }

    renderStyle({ list_style: "gwiazdki" });
    expect(rule(".single-post-content ul:not(.cms-content-list)")).toContain("list-style: disc;");
  });

  it("szerokość figury 'wide' jedzie z ustawień w pikselach", () => {
    renderStyle({ wide_align_max_width: 1280 });

    expect(rule(".single-post-content figure.is-wide")).toContain("max-width: 1280px;");
  });

  it("ramka podpisu obrazu pojawia się i znika razem z przełącznikiem", () => {
    const withBorder = renderStyle({ image_caption_left_border: true });
    expect(rule(".single-post-content figcaption")).toContain("border-left: 3px solid");
    withBorder.unmount();
    styleEl()?.remove();

    renderStyle({ image_caption_left_border: false });
    expect(styleEl()?.textContent).not.toContain("figcaption");
  });

  it("zmiana ustawień nadpisuje TEN SAM arkusz, zamiast doklejać kolejny do <head>", () => {
    const view = renderStyle({ hyperlink_color: "#111111" });
    const first = styleEl();
    expect(first).not.toBeNull();
    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(first?.textContent).toContain("#111111");

    h.settings = settings({ hyperlink_color: "#999999" });
    view.rerender(<PostContentStyle />);

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    // Ten sam węzeł DOM, nowa treść - dowód aktualizacji w miejscu.
    expect(styleEl()).toBe(first);
    expect(first?.textContent).toContain("#999999");
    expect(first?.textContent).not.toContain("#111111");
  });

  it("drugi egzemplarz komponentu dołącza się do istniejącego arkusza", () => {
    const first = renderStyle({ wide_align_max_width: 900 });
    const node = styleEl();

    const second = render(<PostContentStyle />);

    expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1);
    expect(styleEl()).toBe(node);
    first.unmount();
    second.unmount();
  });
});
