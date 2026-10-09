// Wtyczka builda: minifikuje OZNACZONE literały CSS w kodzie źródłowym (P3.7a,
// fala 3, krok S1; specyfikacja `faza3/plany/P3.7.md` §3.1).
//
// CO ROBI. W modułach z listy `STATIC_CSS_MODULES` szuka znacznika
// `STATIC_CSS_MARKER` stojącego tuż przed backtickiem literału szablonowego
// i podmienia treść literału na wynik `minifyStaticCss` (białe znaki
// i komentarze; żadnej transformacji składni - nagłówek modułu minifikatora).
// Interpolacje `${identyfikator}` przechodzą przez minifikację jako znaczniki
// i wracają na swoje miejsce dosłownie.
//
// DLACZEGO W BUILDZIE, NA SUROWYM TS-IE (`enforce: "pre"`). Lekcja
// `localeChunkPlugin.ts` (nagłówek, defekt 2026-09-01): bez `enforce` hook
// dostaje kod PO transpilacji, a nie treść pliku. Tu wejście jest identyczne
// w środowisku klienta i SSR (ten sam surowy plik, ta sama czysta funkcja),
// więc oba bundle niosą bajtowo ten sam napis - parytet hydratacji `StyleSink`
// i `<style href precedence>` wynika z konstrukcji. Dev i vitest wtyczki nie
// mają (`apply: "build"`), więc dostają literał źródłowy - dzisiejsze bajty
// i dzisiejsze testy.
//
// DLACZEGO NIE `?inline`, RUNTIME ANI WYGENEROWANY PLIK - specyfikacja §3.1:
// `?inline` zależy od `cssTarget` środowiska i scala deklaracje (zjada fallback
// `calc(3 * 1.25em)` przed `calc(3lh)`), minifikator w runtime dokładałby kod do
// chunku wejściowego, a plik generowany rozjeżdża się, bo Lovable nie uruchamia
// generatorów.
//
// AWARIE SĄ GŁOŚNE, NIE CICHE:
//  * literał z ukośnikiem wstecznym (ucieczka zmienia znaczenie surowego
//    tekstu), z zagnieżdżonym backtickiem albo z interpolacją inną niż
//    `${a}` / `${a.b}` - błąd builda z plikiem i linią;
//  * znacznik bez literału - błąd builda;
//  * moduł z listy bez ani jednego znacznika - ostrzeżenie builda (literał
//    pojechałby nieminifikowany: strata bajtów, nie awaria). Drugą siatką jest
//    metryka `inlineCssCommentBytes` w `check:document-weight` (próg 0).
import type { Plugin } from "vite";

import { minifyStaticCss } from "../../src/lib/css/minifyStaticCss";

/** Znacznik stawiany w źródle tuż przed backtickiem literału. */
export const STATIC_CSS_MARKER = "/* @nes-static-css */";

/**
 * Moduły z oznaczonymi literałami (ścieżki względem korzenia repo). Jawna
 * lista zamiast skanu całego `src`: wtyczka nie dotyka żadnego innego pliku,
 * a moduł, z którego znacznik zniknął, daje ostrzeżenie.
 */
export const STATIC_CSS_MODULES = [
  "src/components/header/TrendingTicker.tsx",
  "src/lib/builder/sliderVariants.tsx",
  "src/lib/builder/globalColors.ts",
  "src/components/builder/organisms/widget-view/SearchButtonWidget.tsx",
] as const;

/** Prefiks znacznika interpolacji na czas minifikacji (identyfikator CSS). */
const SLOT_PREFIX = "__NES_CSS_I";
const SLOT_RE = /__NES_CSS_I(\d+)__/g;
const INTERPOLATION_RE = /^\s*[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*$/;

/** Błąd oznaczonego literału z pozycją w pliku (offset źródła). */
export class StaticCssError extends Error {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
    this.name = "StaticCssError";
  }
}

export interface StaticCssResult {
  readonly code: string;
  /** Liczba podmienionych literałów. */
  readonly replaced: number;
}

function lineOf(code: string, offset: number): number {
  return code.slice(0, offset).split("\n").length;
}

/** Normalizuje id modułu Vite do ścieżki z `/` (bez zapytania). */
function normalizeId(id: string): string {
  return id.split("?")[0].replace(/\\/g, "/");
}

export function isStaticCssModule(id: string): boolean {
  const file = normalizeId(id);
  return STATIC_CSS_MODULES.some((m) => file === m || file.endsWith(`/${m}`));
}

/**
 * Czysta transformacja: każdy literał po znaczniku dostaje minifikowaną treść.
 * Rzuca `StaticCssError` przy literale, którego nie wolno przepisać.
 */
export function minifyMarkedCssLiterals(code: string): StaticCssResult {
  let out = "";
  let cursor = 0;
  let replaced = 0;
  for (
    let at = code.indexOf(STATIC_CSS_MARKER);
    at !== -1;
    at = code.indexOf(STATIC_CSS_MARKER, cursor)
  ) {
    let open = at + STATIC_CSS_MARKER.length;
    while (open < code.length && /\s/.test(code[open])) open++;
    if (code[open] !== "`") {
      throw new StaticCssError("znacznik statycznego CSS bez literału szablonowego", at);
    }

    // Skan do zamykającego backticka; interpolacje zamieniamy na znaczniki.
    const expressions: string[] = [];
    let body = "";
    let i = open + 1;
    for (;;) {
      if (i >= code.length) throw new StaticCssError("niedomknięty literał", open);
      const ch = code[i];
      if (ch === "`") break;
      if (ch === "\\") {
        throw new StaticCssError(
          "ukośnik wsteczny w literale (ucieczka zmienia znaczenie surowego tekstu)",
          i,
        );
      }
      if (ch === "$" && code[i + 1] === "{") {
        let depth = 1;
        let j = i + 2;
        for (; j < code.length && depth > 0; j++) {
          if (code[j] === "`") throw new StaticCssError("zagnieżdżony backtick w interpolacji", j);
          if (code[j] === "{") depth++;
          else if (code[j] === "}") depth--;
        }
        if (depth > 0) throw new StaticCssError("niedomknięta interpolacja", i);
        const expression = code.slice(i + 2, j - 1);
        if (!INTERPOLATION_RE.test(expression)) {
          throw new StaticCssError(
            `interpolacja \`\${${expression.trim()}}\` nie jest identyfikatorem (dozwolone: \${a}, \${a.b})`,
            i,
          );
        }
        body += `${SLOT_PREFIX}${expressions.length}__`;
        expressions.push(expression);
        i = j;
        continue;
      }
      body += ch;
      i++;
    }
    if (code.slice(open + 1, i).includes(SLOT_PREFIX)) {
      throw new StaticCssError(`literał zawiera zarezerwowany prefiks ${SLOT_PREFIX}`, open);
    }

    let minified: string;
    try {
      minified = minifyStaticCss(body);
    } catch (error) {
      throw new StaticCssError((error as Error).message, open);
    }
    // Minifikacja zdejmuje spacje przed `{`, więc `$ {` w CSS stałby się
    // interpolacją. Takiego CSS-u nie ma; gdyby się pojawił - błąd, nie cichy kod.
    if (minified.includes("${")) {
      throw new StaticCssError("minifikacja utworzyłaby sekwencję `${`", open);
    }
    const seen = new Set<number>();
    const restored = minified.replace(SLOT_RE, (_, n: string) => {
      const index = Number(n);
      if (index >= expressions.length || seen.has(index)) {
        throw new StaticCssError(`znacznik interpolacji ${index} poza listą`, open);
      }
      seen.add(index);
      return `\${${expressions[index]}}`;
    });
    if (seen.size !== expressions.length) {
      throw new StaticCssError("minifikacja zgubiła interpolację", open);
    }

    out += `${code.slice(cursor, open)}\`${restored}\``;
    cursor = i + 1;
    replaced++;
  }
  return { code: replaced === 0 ? code : out + code.slice(cursor), replaced };
}

export function staticCssPlugin(): Plugin {
  return {
    name: "nes:static-css",
    apply: "build",
    // PRZED rdzeniowym `vite:esbuild`: hook ma dostać surowy TS (patrz nagłówek).
    enforce: "pre",
    transform(code, id) {
      if (!isStaticCssModule(id)) return null;
      const file = normalizeId(id);
      let result: StaticCssResult;
      try {
        result = minifyMarkedCssLiterals(code);
      } catch (error) {
        if (!(error instanceof StaticCssError)) throw error;
        return this.error(
          `nes:static-css - ${file}:${lineOf(code, error.offset)}: ${error.message}`,
        );
      }
      if (result.replaced === 0) {
        this.warn(
          `nes:static-css - brak oznaczonego literału w ${file}; ` +
            "arkusz pojedzie nieminifikowany (bramka inlineCssCommentBytes w check:document-weight)",
        );
        return null;
      }
      return { code: result.code, map: null };
    },
  };
}
