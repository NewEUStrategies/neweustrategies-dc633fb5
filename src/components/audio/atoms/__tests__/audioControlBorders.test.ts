// KRAWĘDZIE KONTROLEK ODSŁUCHU: DELIKATNIE CIEMNIEJSZA LINIA W JASNYM MOTYWIE.
//
// PO CO TEN PLIK ISTNIEJE. Przycisk odtwarzania, trójkąt play i kwadrat "stop"
// mają wypełnienie w kolorze powierzchni (`text-background`, `bg-primary`). Na
// jasnym tle zlewały się krawędziami z tym, co je otacza, więc każdy z nich
// dostaje delikatnie ciemniejszą linię WŁASNEJ powierzchni - nie osobny kolor.
// Bramka pilnuje trzech rzeczy, których nie widać w jednym screenshocie:
//
//  1. Krawędź jest MESZANKĄ z atramentem, a nie nową marką. Tokeny typu
//     `--audio-control-border` i `--audio-icon-border` są mieszane z `#000`,
//     więc zmiana brandu czy tekstu rusza je automatycznie.
//  2. "Delikatnie" ma górną i dolną granicę. Mieszanka poniżej 60% to już
//     wyraźna obwódka, powyżej 90% - krawędź znikająca. Próg notujemy tu,
//     bo w CSS nie da się go wyrazić jako błędu.
//  3. W ciemnym motywie tokeny wracają do `transparent`. Dopisana linia na
//     ciemnej płycie byłaby jasną ramką, a nie detalem - to jest dokładnie ta
//     różnica, którą "light mode" w prośbie użytkownika oznacza.
//
// OSTATNIA ASECJA DOTYCZY DOCELOWANIA. Sam token nic nie znaczy, jeśli żadna
// reguła go nie czyta i żaden przycisk nie niesie klasy - dlatego sprawdzamy
// też, że reguły istnieją, a `SidebarListenCard` nadal używa `.listen-play-toggle`.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AUDIO_ICON_BUTTON_VARIANTS } from "@/components/audio/atoms/AudioIconButton";

const css = readFileSync("src/styles.css", "utf8");
const card = readFileSync("src/components/audio/SidebarListenCard.tsx", "utf8");

/** Jasny motyw: cała głowa arkusza, czyli blok `:root, .light` (i `@theme`). */
const HEAD = css.slice(0, css.indexOf(".dark {"));
/** Blok `.dark` cięty identycznie jak bramka halacji tekstu (`darkForeground`). */
const DARK = css.slice(css.indexOf(".dark {"), css.indexOf("@layer base"));

const TOKENS = [
  "--audio-control-border",
  "--audio-icon-border",
  "--voice-stop-border",
] as const;

function token(block: string, name: string, where: string): string {
  const m = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`brak tokenu ${name} w ${where}`);
  return m[1].trim().toLowerCase();
}

describe("tokeny krawędzi kontrolek odsłuchu", () => {
  it("jasny motyw miesza każdą krawędź z atramentem, w granicach \"delikatnie\"", () => {
    for (const name of TOKENS) {
      const value = token(HEAD, name, "bloku :root/.light");
      expect(value).toContain("color-mix(in oklab");
      // Ciemniejszy składnik mieszanki: pełna czerń albo atrament tekstu.
      expect(value).toMatch(/#000|var\(--foreground\)/);
      const percent = Number(/(\d{1,3})%/.exec(value)?.[1]);
      expect(Number.isFinite(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(60);
      expect(percent).toBeLessThanOrEqual(90);
    }
  });

  it("krawędź ikony jest ciemnopomarańczowa, a nie szara", () => {
    // Użytkownik chce, żeby trójkąt play i słupki pauzy miały obramowanie w
    // rodzinie brandu. Mieszanka z `var(--foreground)` dałaby szarość - tego
    // właśnie ta asercja zabrania.
    const value = token(HEAD, "--audio-icon-border", "bloku :root/.light");
    expect(value).toContain("var(--brand)");
    expect(value).not.toContain("var(--foreground)");
    expect(value).not.toContain("var(--background)");
  });

  it("ciemny motyw wyłącza wszystkie trzy krawędzie", () => {
    for (const name of TOKENS) {
      expect(token(DARK, name, "bloku .dark")).toBe("transparent");
    }
  });
});

describe("reguły czytające te krawędzie", () => {
  const controlBlock = css.slice(css.indexOf(".listen-play-toggle {"), css.indexOf(".mpp {"));

  it("przyciski odtwarzania (karta sidebaru i dolny pasek) biorą krawędź z tokenu", () => {
    expect(controlBlock).toContain(".listen-play-toggle {");
    expect(controlBlock).toContain(".audio-control-btn {");
    expect(controlBlock.match(/border: 1px solid var\(--audio-control-border\);/g)).toHaveLength(2);
    // Żadnego wpisanego na sztywno koloru - inaczej krawędź nie nadąży za motywem.
    expect(controlBlock).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("ikony play i pauza dostają cienką krawędź z tokenu (stroke, nie nowy kształt)", () => {
    const block = css.slice(
      css.indexOf(".mpp-svg-play path,"),
      css.indexOf('.mpp[data-playing="false"]'),
    );
    // Jedna reguła obsługuje oba kształty - trójkąt i słupki pauzy.
    expect(block).toContain(".mpp-svg-play path,");
    expect(block).toContain(".mpp-svg-pause rect {");
    expect(block.match(/stroke: var\(--audio-icon-border\);/g)).toHaveLength(1);
    const width = Number(/stroke-width:\s*([\d.]+);/.exec(block)?.[1]);
    expect(width).toBeGreaterThan(0);
    expect(width).toBeLessThanOrEqual(1.5);
  });

  it("kwadrat \"stop\" dostaje pierścień z tokenu", () => {
    expect(css).toMatch(
      /\.voice-stop-square \{[^}]*box-shadow: 0 0 0 1px var\(--voice-stop-border\)/,
    );
  });

  it("przycisk odtwarzania w dolnym pasku niesie klasę regulującą krawędź", () => {
    expect(AUDIO_ICON_BUTTON_VARIANTS.primary).toContain("audio-control-btn");
  });

  it("karta odsłuchu nadal wypisuje oba przyciski objęte krawędzią", () => {
    // Wariant `full-width` (mobilny) i `compact` (sidebar) - ten drugi to
    // przycisk wskazany przez użytkownika.
    expect(card.match(/listen-play-toggle/g)).toHaveLength(2);
  });
});
