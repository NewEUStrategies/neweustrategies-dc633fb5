// MINIFIKACJA STATYCZNYCH LITERAŁÓW CSS (P3.7a, fala 3, krok S1).
//
// PO CO. Cztery arkusze-literały (`TICKER_CSS`, `SHARED_STYLES` slidera, most
// widgetów w `globalColors.ts`, `SEARCH_WIDGET_CSS`) jadą do przeglądarki DWA
// razy: w JS-ie (chunk wejściowy, `sliderVariants-*.js`, `designTokensCss`)
// i w HTML-u (inline `<style>`). Wcięcia, komentarze i puste linie to ok.
// 10 KB raw / 3,5 KB gzip dokumentu `/` i 4,9 KB raw domknięcia bootu
// (diagnoza `faza3/diagnoza/waga-dokumentu.md` §3.1, S1).
//
// KTO WOŁA. Wyłącznie wtyczka builda `scripts/lib/staticCssPlugin.ts` (na
// surowym TS-ie, w obu środowiskach: klient i SSR). Kod aplikacji tego modułu
// NIE importuje, więc nie trafia do żadnego bundla; dev i vitest dostają
// literały źródłowe bez zmian.
//
// CO ROBI - TYLKO BIAŁE ZNAKI I KOMENTARZE, ŻADNEJ TRANSFORMACJI SKŁADNI:
//  1. komentarz `/* ... */` staje się separatorem białych znaków, a każdy ciąg
//     białych znaków poza napisami - jedną spacją;
//  2. spacje obok `{`, `}` i `;` (głębokość nawiasów 0) znikają;
//  3. w deklaracji znikają spacje wokół PIERWSZEGO `:` na głębokości 0;
//     wartość zostaje dosłownie (spacje po przecinkach, w `var()`,
//     `color-mix()` i we właściwościach `--*` - JS czytający
//     `getPropertyValue("--...")` dostaje ten sam tekst co przed minifikacją);
//  4. w preludium (selektor albo prelude at-rule) znikają spacje wokół `,`
//     i `>` na głębokości 0; kombinator potomka, `+`, `~` i zawartość nawiasów
//     (`:where(a, b)`, `(max-width: 1024px)`) zostają;
//  5. `;` bezpośrednio przed `}` znika, całość jest przycięta.
// Napisy `"..."` i `'...'` oraz ucieczki `\X` są przepisywane DOSŁOWNIE - stąd
// m.in. stos `var(--font-display, "Red Hat Display", system-ui, sans-serif)`
// zostaje bajt w bajt (jedynym fontem ścieżki krytycznej jest Red Hat Display).
//
// Segment (od początku i od każdego `{`, `;`, `}` na głębokości 0) jest
// PRELUDIUM, gdy pierwszym separatorem `{`/`;`/`}` poza nawiasami i napisami
// jest `{`; w przeciwnym razie jest DEKLARACJĄ.
//
// DLACZEGO WŁASNY MINIFIKATOR, A NIE lightningcss/esbuild. Lightningcss przy
// `minify` scala deklaracje: zjada fallback `height: calc(3 * 1.25em ...)`
// przed `height: calc(3lh ...)` w arkuszu slidera, a wynik `?inline` zależy od
// `cssTarget` środowiska (SSR i klient mogą dostać różne bajty). Tu wynik jest
// czystą funkcją wejścia - parytet bajtowy SSR/klient wynika z konstrukcji.
// Równoważność z oryginałem sprawdza wyrocznia w dowodzie P3.7a (lightningcss
// na obu wersjach daje identyczny CSS).
//
// BŁĘDY. Wyjątek przy niedomkniętym napisie, komentarzu, nawiasie albo
// klamrze i przy nadmiarowym domknięciu - wtyczka zamienia go na błąd builda
// z plikiem i linią. Funkcja jest idempotentna: f(f(x)) === f(x).

type Token =
  | { readonly kind: "space" }
  | { readonly kind: "string"; readonly text: string }
  | { readonly kind: "char"; readonly text: string };

const SPACE: Token = { kind: "space" };

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r" || c === "\f";

/** Pozycja w czytelnej postaci do komunikatu błędu (linia:kolumna, od 1). */
function where(css: string, index: number): string {
  const before = css.slice(0, index);
  const line = before.split("\n").length;
  const column = index - before.lastIndexOf("\n");
  return `${line}:${column}`;
}

function tokenize(css: string): Token[] {
  const out: Token[] = [];
  const pushSpace = () => {
    if (out.length > 0 && out[out.length - 1].kind !== "space") out.push(SPACE);
  };
  let i = 0;
  const n = css.length;
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && css[j] !== c) {
        // Surowy koniec linii w napisie to w CSS „bad-string" - nie zgadujemy.
        if (css[j] === "\n")
          throw new Error(`minifyStaticCss: niedomknięty napis (${where(css, i)})`);
        j += css[j] === "\\" ? 2 : 1;
      }
      if (j >= n) throw new Error(`minifyStaticCss: niedomknięty napis (${where(css, i)})`);
      out.push({ kind: "string", text: css.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      if (end < 0) throw new Error(`minifyStaticCss: niedomknięty komentarz (${where(css, i)})`);
      pushSpace();
      i = end + 2;
      continue;
    }
    if (isSpace(c)) {
      while (i < n && isSpace(css[i])) i++;
      pushSpace();
      continue;
    }
    if (c === "\\") {
      // Ucieczka jest jednym znakiem: `\{` ani `\;` nie są strukturą arkusza.
      if (i + 1 >= n) throw new Error(`minifyStaticCss: ucieczka na końcu (${where(css, i)})`);
      out.push({ kind: "char", text: css.slice(i, i + 2) });
      i += 2;
      continue;
    }
    out.push({ kind: "char", text: c });
    i++;
  }
  return out;
}

const OPEN = new Set(["(", "["]);
const CLOSE = new Set([")", "]"]);

/** Czy segment od `start` jest preludium (pierwszy separator na głębokości 0 to `{`). */
function isPrelude(tokens: readonly Token[], start: number): boolean {
  let depth = 0;
  for (let k = start; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind !== "char") continue;
    if (OPEN.has(t.text)) depth++;
    else if (CLOSE.has(t.text)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && (t.text === "{" || t.text === ";" || t.text === "}")) {
      return t.text === "{";
    }
  }
  return false;
}

export function minifyStaticCss(css: string): string {
  const tokens = tokenize(css);
  const out: string[] = [];
  const dropTrailingSpace = () => {
    while (out.length > 0 && out[out.length - 1] === " ") out.pop();
  };

  let prelude = isPrelude(tokens, 0);
  let depth = 0;
  let braces = 0;
  let colonSeen = false;
  // Po znaku, który „zjada" spacje za sobą (`{`, `;`, `}`, `,`/`>` preludium,
  // pierwszy `:` deklaracji), następna spacja nie jest emitowana.
  let suppressSpace = true;

  const startSegment = (next: number) => {
    prelude = isPrelude(tokens, next);
    colonSeen = false;
    suppressSpace = true;
  };

  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.kind === "space") {
      if (!suppressSpace && out.length > 0) out.push(" ");
      suppressSpace = true; // ciąg spacji jest już jednym tokenem; druga z rzędu nie powstanie
      continue;
    }
    if (t.kind === "string") {
      out.push(t.text);
      suppressSpace = false;
      continue;
    }
    const c = t.text;
    if (depth === 0 && (c === "{" || c === ";" || c === "}")) {
      dropTrailingSpace();
      if (c === "}") {
        if (braces === 0) throw new Error("minifyStaticCss: nadmiarowe `}`");
        braces--;
        while (out.length > 0 && out[out.length - 1] === ";") {
          out.pop();
          dropTrailingSpace();
        }
      }
      if (c === "{") braces++;
      // Pusta wartość właściwości (`--x: ;`) zachowuje spację - `--x:;` starsze
      // silniki odrzucają jako deklarację bez wartości.
      if (c !== "{" && out.length > 0 && out[out.length - 1] === ":") out.push(" ");
      out.push(c);
      startSegment(k + 1);
      continue;
    }
    if (OPEN.has(c)) depth++;
    else if (CLOSE.has(c)) {
      if (depth === 0) throw new Error(`minifyStaticCss: nadmiarowe \`${c}\``);
      depth--;
    }
    if (depth === 0 && !prelude && c === ":" && !colonSeen) {
      dropTrailingSpace();
      out.push(c);
      colonSeen = true;
      suppressSpace = true;
      continue;
    }
    if (depth === 0 && prelude && (c === "," || c === ">")) {
      dropTrailingSpace();
      out.push(c);
      suppressSpace = true;
      continue;
    }
    out.push(c);
    suppressSpace = false;
  }

  if (depth !== 0) throw new Error("minifyStaticCss: niedomknięty nawias");
  if (braces !== 0) throw new Error("minifyStaticCss: niedomknięta klamra");
  dropTrailingSpace();
  return out.join("");
}
