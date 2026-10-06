// Animacje uruchamiane przy ŁADOWANIU strony animują wyłącznie właściwości
// kompozytorowe (`transform`, `opacity` i ich odpowiedniki `translate`,
// `scale`, `rotate`) - Wydajność PSI 85/95, fala 2, P2.4 (css:C9, F17 raportu
// P0.5).
//
// DLACZEGO. Księga P0.5 (K8): „zadanie kompozytora" na mobile x4 to start
// animacji CSS (`PendingAnimations::notifyCompositorAnimationStarted`), a
// najdroższe były animacje NIEkompozytorowe startujące z pierwszą klatką:
// `lv-shimmer` na `background-position` (40 szkieletów sekcji) i wejście
// obrazów `oi-fade-in` (F1/F1b fali 1 je zdjęły). Animacja `background-*`,
// `height`, `stroke-*`, `filter` itd. liczy się na głównym wątku w każdej
// klatce i wydłuża zadania w oknie TBT.
//
// KONTRAKT. Każda reguła z `animation`/`animation-name` w `src/styles.css`,
// której klatki kluczowe ruszają czymś innym niż właściwości kompozytorowe,
// musi być (a) za stanem interakcji w selektorze (`:hover`, `[data-state=…]`,
// `.active` …) albo (b) na liście wyjątków niżej - z powodem, dla którego nie
// startuje przy ładowaniu publicznej strony. Nowa animacja „przy ładowaniu"
// na `background-position` oblewa ten test.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCssBlocks, type CssBlock } from "@/test/cssRules";

const ROOT = parseCssBlocks(readFileSync("src/styles.css", "utf8"));

/** Nazwa klatek -> animowane właściwości. */
const KEYFRAMES = new Map<string, Set<string>>();
(function collect(blocks: CssBlock[]) {
  for (const block of blocks) {
    const kf = /^@(?:-webkit-)?keyframes\s+([\w-]+)/.exec(block.prelude);
    if (kf) {
      const props = new Set<string>();
      const walk = (frames: CssBlock[]) =>
        frames.forEach((frame) => {
          frame.declarations.forEach((d) => props.add(d.split(":")[0].trim()));
          walk(frame.children);
        });
      walk(block.children);
      KEYFRAMES.set(kf[1], props);
    } else collect(block.children);
  }
})(ROOT);

interface AnimationUse {
  /** Łańcuch preludiów od korzenia (at-reguły i selektory). */
  context: string[];
  value: string;
  keyframes: string[];
}

const USES: AnimationUse[] = [];
(function collect(blocks: CssBlock[], context: string[]) {
  for (const block of blocks) {
    if (/^@(?:-webkit-)?keyframes/.test(block.prelude)) continue;
    const here = [...context, block.prelude];
    for (const declaration of block.declarations) {
      const [prop, ...rest] = declaration.split(":");
      if (!/^\s*animation(-name)?\s*$/.test(prop)) continue;
      const value = rest.join(":").trim();
      const names = value
        .split(/[\s,]+/)
        .filter((token) => KEYFRAMES.has(token))
        .filter((token, index, all) => all.indexOf(token) === index);
      USES.push({ context: here, value, keyframes: names });
    }
    collect(block.children, here);
  }
})(ROOT, []);

const COMPOSITOR = new Set(["opacity", "transform", "translate", "scale", "rotate", "offset"]);

/**
 * Stan interakcji w selektorze: animacja nie startuje przy ładowaniu. Tylko
 * stany, które ustawia działanie użytkownika - NIE atrybuty wariantu
 * (`[data-entrance=…]` karty promocyjnej to animacja wejścia przy ładowaniu,
 * recenzja P2.4 m2); wyjątek spoza tej listy idzie do `NOT_ON_LOAD` z powodem.
 */
const INTERACTION =
  /:hover|:focus|:active|:checked|\[data-state|\[aria-expanded|\[aria-selected|\[open\]/;

/**
 * Wyjątki: animacje niekompozytorowe, które NIE startują przy ładowaniu
 * publicznej strony anonima. Klucz = fragment selektora, wartość = powód.
 */
const NOT_ON_LOAD: Record<string, string> = {
  ".skeleton-shimmer":
    "szkielety klienckie (dok, kolejny wpis, lista wydarzeń w trakcie ładowania trasy) - " +
    "nie ma ich w HTML-u SSR; szkielet sekcji strumieniowanej jest statyczny (F1b, test niżej)",
  ".chat-jump-flash": "czat członka - podświetlenie po kliknięciu skoku do wiadomości",
  ".animate-accordion-down": "rozwinięcie akordeonu po kliknięciu (Radix)",
  ".animate-accordion-up": "zwinięcie akordeonu po kliknięciu (Radix)",
  ".mbb__item.active":
    "pasek dolny doku - wyłącznie zalogowani (`SiteChrome`: `WorkspaceDock` tylko z `user`), " +
    "poza śladem Lighthouse anonima",
  ".voice-eq-bar--active": "nagrywanie wiadomości głosowej - po kliknięciu mikrofonu",
};

describe("animacje przy ładowaniu - tylko właściwości kompozytorowe", () => {
  it("parser widzi klatki kluczowe i ich użycia (kontrapunkt)", () => {
    expect(KEYFRAMES.size).toBeGreaterThan(20);
    expect(USES.length).toBeGreaterThan(30);
    expect(KEYFRAMES.get("lv-shimmer")).toEqual(new Set(["background-position"]));
  });

  it("każda animacja niekompozytorowa jest za interakcją albo na liście wyjątków", () => {
    const offenders: string[] = [];
    for (const use of USES) {
      const animated = use.keyframes.flatMap((name) => [...(KEYFRAMES.get(name) ?? [])]);
      const paint = animated.filter((prop) => !COMPOSITOR.has(prop));
      if (paint.length === 0) continue;
      const chain = use.context.join(" ");
      if (INTERACTION.test(chain)) continue;
      if (Object.keys(NOT_ON_LOAD).some((fragment) => chain.includes(fragment))) continue;
      offenders.push(`${chain} -> ${use.keyframes.join(",")} (${paint.join(", ")})`);
    }
    expect(offenders).toEqual([]);
  });

  it("animacja wejścia z atrybutu wariantu podlega kontraktowi (nie jest stanem interakcji)", () => {
    // `[data-promo-card][data-entrance=…]` startuje przy ładowaniu karty -
    // test wyżej sprawdza jej klatki jak każdej animacji przy ładowaniu.
    const entrance = USES.filter((use) => use.context.join(" ").includes("[data-entrance"));
    expect(entrance.length).toBeGreaterThan(0);
    for (const use of entrance) expect(INTERACTION.test(use.context.join(" "))).toBe(false);
  });

  it("lista wyjątków nie zawiera martwych wpisów", () => {
    for (const fragment of Object.keys(NOT_ON_LOAD)) {
      expect(
        USES.some((use) => use.context.join(" ").includes(fragment)),
        fragment,
      ).toBe(true);
    }
  });

  it("obrazy z SSR nie mają animacji wejścia (F1: `.oi-fade-in`)", () => {
    const fadeIn = USES.filter((use) => use.context.join(" ").includes("oi-fade-in"));
    expect(fadeIn).toEqual([]);
  });

  it("szkielet sekcji strumieniowanej jest statyczny (F1b)", () => {
    const stream = USES.filter((use) =>
      use.context.join(" ").includes("[data-section-stream-skeleton] .skeleton-shimmer"),
    );
    expect(stream.map((use) => use.value)).toEqual(["none"]);
  });
});
