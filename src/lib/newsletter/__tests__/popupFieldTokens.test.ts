// Regresja pól popupu rejestracji: wygląd i zachowanie etykiet / podpowiedzi
// musi być IDENTYCZNE jak w widgecie „Dołącz do nas", a panelu nie wolno dać
// się przesuwać w poziomie.
//
// Skąd te dwa inwarianty:
//
//  1. TOKENY PÓL. Runtime'owy <style> globalnych kolorów (src/lib/builder/
//     globalColors.ts) maluje KAŻDE pole regułą `:where(input…){background:
//     var(--gc-input-bg, transparent); color: var(--gc-input-text, inherit);
//     border-color: var(--gc-input-border, currentColor); font-size:
//     var(--gc-input-text-size, inherit)}`. Reguła jest BEZWARSTWOWA, więc bije
//     każdą regułę z `@layer components` - także `.nlp …` - niezależnie od
//     specyficzności. Dopóki popup nie przemapowywał tych tokenów, pola na
//     ciemnym panelu dostawały JASNE tło motywu strony (zmierzone #f6f4f2),
//     a pływająca etykieta (jasny atrament panelu) stawała się na nich
//     niewidoczna. Kaskadę wygrywa się tu wyłącznie tokenem.
//
//  2. BRAK PRZESUWANIA. Kolumna formularza ma `overflow-y: auto` (treść wyższa
//     niż 92vh musi się przewijać), a spec CSS nie dopuszcza `visible` na jednej
//     osi obok `auto` na drugiej - `overflow-x` sam robi się `auto`. Każdy
//     element wystający w bok robił z tego poziomą przestrzeń do przewijania
//     i całą treść popupu dało się przesunąć trackpadem (zmierzone w Chromium:
//     scrollWidth 507 px przy clientWidth 455 px - sprawcą były dekoracyjne
//     „bąbelki" `.btn-bubbly::before/::after` o szerokości 150%).
//
// i18n: brak treści dla użytkownika - test narzędziowy.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultPopupDesign,
  popupPaletteVars,
  resolvePopupPalette,
} from "@/lib/newsletter/popupDesign";
import type { PopupColorSource } from "@/lib/newsletter/popupDesign";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/**
 * Treść każdego bloku `@layer utilities { … }`, wycięta liczeniem nawiasów.
 * Regex tego nie zrobi: w środku są reguły z własnymi `{}`, więc `[^}]*`
 * kończy się na pierwszej z nich.
 */
function utilitiesLayers(): string[] {
  const out: string[] = [];
  const opener = /@layer utilities\s*\{/g;
  let match = opener.exec(CSS);
  while (match !== null) {
    let depth = 0;
    let i = match.index + match[0].length - 1;
    const start = i + 1;
    while (i < CSS.length) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
      i += 1;
    }
    out.push(CSS.slice(start, i));
    match = opener.exec(CSS);
  }
  return out;
}
const PANEL = readFileSync(
  resolve(process.cwd(), "src/components/popups/SignupPopupPanel.tsx"),
  "utf8",
);

/** Ciemny panel referencyjny: biały atrament na prawie czarnym tle. */
const source: PopupColorSource = {
  popup_bg_color: "#0b0b0f",
  popup_text_color: "#ffffff",
  popup_muted_color: "#a8a8b3",
  popup_accent_color: "#fa9346",
  popup_accent_text_color: "#141414",
  popup_overlay_color: "rgba(10,10,15,0.55)",
  popup_showcase_grad_from: null,
  popup_showcase_grad_to: null,
  popup_design: defaultPopupDesign(),
};

function darkVars(): Record<string, string> {
  return popupPaletteVars(resolvePopupPalette(source, "dark"), 6);
}

describe("popupPaletteVars - tokeny pól", () => {
  it("przemapowuje WSZYSTKIE tokeny, którymi globalColors maluje pola", () => {
    const vars = darkVars();
    // Dokładnie te tokeny czyta bezwarstwowa reguła z globalColors.ts.
    for (const token of [
      "--gc-input-bg",
      "--gc-input-hover-bg",
      "--gc-input-text",
      "--gc-input-border",
      "--gc-input-text-size",
      "--gc-input-placeholder",
    ]) {
      expect(vars[token], token).toBeTruthy();
    }
  });

  it("liczy tło pola z atramentu panelu, nie z motywu strony", () => {
    const vars = darkVars();
    // Subtelne wypełnienie na panelu: 4% atramentu w spoczynku, 7% pod kursorem.
    expect(vars["--gc-input-bg"]).toBe("color-mix(in srgb, #ffffff 4%, transparent)");
    expect(vars["--gc-input-hover-bg"]).toBe("color-mix(in srgb, #ffffff 7%, transparent)");
    // Atrament i ramka też z palety - inaczej na ciemnym panelu zostawał
    // ciemny tekst i jasna kreska motywu strony.
    expect(vars["--gc-input-text"]).toBe("#ffffff");
    expect(vars["--gc-input-border"]).toBe(vars["--border"]);
  });

  it("etykieta w spoczynku i podpowiedź jadą z JEDNEGO tokenu, jak w „Dołącz do nas”", () => {
    const vars = darkVars();
    // `.input-group > .user-label { color: var(--gc-input-placeholder, …) }`
    // obsługuje etykietę w spoczynku, ta sama zmienna maluje ::placeholder.
    expect(vars["--gc-input-placeholder"]).toBe("color-mix(in srgb, #ffffff 74%, transparent)");
    expect(vars["--gc-input-placeholder-dark"]).toBe(vars["--gc-input-placeholder"]);
    // Po focusie / wypełnieniu etykieta bierze `--ring`, a chip `--background`.
    expect(vars["--ring"]).toBe("#fa9346");
    expect(vars["--background"]).toBe("#0b0b0f");
  });

  it("trzyma rozmiar pisma pól na 14 px (tyle samo, co pola „Dołącz do nas”)", () => {
    // Token, nie `!important` w CSS: mobilna bramka iOS (`font-size: 16px
    // !important` poniżej 768 px, przeciw auto-zoomowi) musi nadal wygrywać.
    expect(darkVars()["--gc-input-text-size"]).toBe("0.875rem");
    expect(CSS).toContain("font-size: 16px !important");
  });

  it("działa tak samo dla palety jasnej", () => {
    const vars = popupPaletteVars(resolvePopupPalette(source, "light"), 6);
    const fg = vars["--foreground"];
    expect(vars["--gc-input-bg"]).toBe(`color-mix(in srgb, ${fg} 4%, transparent)`);
    expect(vars["--gc-input-text"]).toBe(fg);
  });
});

describe("src/styles.css - zakres `.nlp`", () => {
  /** Ciało reguł `.nlp …` (bez komentarzy) - tam szukamy zabronionych nadpisań. */
  function nlpRuleBodies(): string {
    const withoutComments = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    return (withoutComments.match(/\.nlp[^{}]*\{[^}]*\}/g) ?? []).join("\n");
  }

  it("nie nadpisuje wyglądu pól - to musi iść tokenami --gc-input-*", () => {
    const bodies = nlpRuleBodies();
    // Reguła z globalColors.ts jest bezwarstwowa, więc każde `.nlp` na polu
    // byłoby martwym kodem, który tylko udaje, że coś ustawia.
    expect(bodies).not.toMatch(/\.nlp[^{}]*\.input\b[^{}]*\{[^}]*background/);
    expect(bodies).not.toMatch(/\.nlp[^{}]*\.input\b[^{}]*\{[^}]*font-size/);
  });

  it("nie powtarza geometrii pływającej etykiety z atomu platformy", () => {
    // Popup korzysta z niezmienionego `.input-group`/`.user-label`; duplikat
    // rozjeżdżał się z widgetem „Dołącz do nas" przy każdej zmianie atomu.
    expect(nlpRuleBodies()).not.toMatch(/\.nlp[^{}]*\.user-label[^{}]*\{[^}]*(top|transform):/);
  });

  it("trzyma dekoracje CTA w obrysie przycisku (źródło poziomego overflow)", () => {
    // Warstwa `utilities` jest obowiązkowa: `btn-bubbly` to `@utility`, więc
    // reguła z `components` przegrałaby z nim niezależnie od specyficzności.
    //
    // Szukamy reguły W ŚRODKU bloku `@layer utilities`, nie NA JEGO POCZĄTKU.
    // Poprzedni wzorzec wymagał, żeby stała bezpośrednio po `@layer utilities {`,
    // i oblał, gdy przed nią wpisano `.nlp .btn-bubbly { background-color… }` -
    // przy nienaruszonej regule i nienaruszonej warstwie. Sąsiedztwo w pliku to
    // formatowanie, a inwariantem jest przynależność do warstwy.
    const body = utilitiesLayers()
      .map((layer) =>
        layer.match(/\.nlp \.btn-bubbly::before,\s*\.nlp \.btn-bubbly::after \{([^}]*)\}/),
      )
      .find((match) => match !== null)?.[1];
    expect(body, "reguła `.nlp .btn-bubbly::before/::after` musi siedzieć w @layer utilities")
      .toBeDefined();
    expect(body).toContain("width: 100%");
    expect(body).toContain("left: 0");
    expect(body).toContain("transform: none");
  });
});

describe("SignupPopupPanel - panelu nie da się przesunąć", () => {
  it("panel przycina zawartość bez tworzenia kontenera przewijania", () => {
    // `overflow-clip` zamiast `hidden`: przycina tak samo, ale nie da się go
    // przewinąć ani gestem, ani programowo (np. dojazdem do focusa).
    expect(PANEL).toContain("overflow-clip md:[grid-template-columns:var(--nl-cols)]");
    expect(PANEL).not.toMatch(/overflow-hidden md:\[grid-template-columns/);
  });

  it("kolumna galerii również tylko przycina", () => {
    expect(PANEL).toContain("md:max-h-[92vh] md:overflow-clip");
  });

  it("kolumna formularza przewija się wyłącznie w pionie", () => {
    expect(PANEL).toContain("md:overflow-y-auto md:overflow-x-clip");
    expect(PANEL).toContain("overscroll-contain");
  });
});
