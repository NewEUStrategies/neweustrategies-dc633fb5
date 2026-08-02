/**
 * Strażnik kaskady dla `src/styles.css`.
 *
 * PROBLEM, KTÓRY TO ŁAPIE
 * `@import "tailwindcss"` deklaruje `@layer theme, base, components, utilities`.
 * W CSS reguła zapisana POZA jakąkolwiek warstwą wygrywa z każdą regułą
 * warstwową - niezależnie od specyficzności. Reguła o ZEROWEJ specyficzności
 * (cały selektor owinięty w `:where()`) deklaruje więc jedno, a robi drugie:
 * autor pisze „to tylko baseline, utility mnie nadpisze", a w praktyce ta
 * reguła bije każde `h-9` / `px-2` / `text-xs` z `@layer utilities`.
 *
 * Dokładnie tak umarło `pl-9` na polu kraju w widgecie „Dołącz do nas":
 * `:where(input…){padding-inline:…}` kasowało wcięcie i flaga wchodziła na
 * nazwę kraju. Inwariant poniżej wyłapuje każdy nawrót tej klasy błędu.
 *
 * INWARIANT
 * Reguła o zerowej specyficzności musi leżeć w warstwie kaskady.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */

export interface UnlayeredZeroSpecificityRule {
  /** Numer linii, w której zaczyna się selektor (1-indeksowany). */
  line: number;
  selector: string;
}

/**
 * Rozbija listę selektorów po przecinkach NAJWYŻSZEGO poziomu - przecinki
 * wewnątrz `:where(…)` / `:not(…)` / `:is(…)` należą do argumentów tych
 * pseudoklas, nie do listy.
 */
export function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Czy POJEDYNCZY selektor ma zerową specyficzność, tzn. każdy jego człon
 *  siedzi w `:where()` i nie ma poza tym typów, klas, atrybutów ani pseudoklas.
 *  Listy rozbijaj wcześniej przez `splitSelectorList()` - w liście
 *  `:where(input), .custom` groźny jest już sam pierwszy człon. */
export function hasZeroSpecificity(selector: string): boolean {
  // Usuwamy pełne grupy `:where(...)` (razem z zagnieżdżonymi nawiasami) -
  // one z definicji nic nie wnoszą do specyficzności.
  let rest = selector;
  let guard = 0;
  while (rest.includes(":where(") && guard++ < 50) {
    const start = rest.indexOf(":where(");
    let depth = 0;
    let end = -1;
    for (let i = start + ":where(".length - 1; i < rest.length; i++) {
      if (rest[i] === "(") depth++;
      else if (rest[i] === ")") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) return false;
    rest = rest.slice(0, start) + " " + rest.slice(end + 1);
  }
  if (rest.includes(":where(")) return false;
  // Co zostało poza `:where()`? Kombinatory i białe znaki są nieszkodliwe;
  // cokolwiek innego (typ, klasa, #id, [attr], :pseudo, ::pseudo-element)
  // podnosi specyficzność powyżej zera.
  return rest.replace(/[\s>+~*]/g, "") === "";
}

type BlockKind = "layer" | "at" | "rule";

/** Wycina komentarze, zachowując znaki nowej linii - numeracja linii w raporcie
 *  musi zgadzać się z plikiem źródłowym. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

/**
 * Znajduje reguły o zerowej specyficzności zapisane poza `@layer`.
 *
 * Parser jest znakowy (prelude → `{` → blok), więc poprawnie obsługuje
 * selektory łamane na kilka linii i zagnieżdżenia `@layer` / `@media`.
 * `styles.css` nie zawiera klamer w stringach ani w `url()`, więc nie
 * potrzeba tu pełnego parsera CSS.
 */
export function findUnlayeredZeroSpecificityRules(css: string): UnlayeredZeroSpecificityRule[] {
  const src = stripComments(css);
  const found: UnlayeredZeroSpecificityRule[] = [];
  const stack: BlockKind[] = [];
  let prelude = "";
  let preludeLine = 1;
  let line = 1;

  const inLayer = () => stack.includes("layer");
  const inDeclarations = () => stack[stack.length - 1] === "rule";

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") {
      line++;
      if (!prelude.trim()) preludeLine = line;
      prelude += " ";
      continue;
    }
    if (ch === "{") {
      const head = prelude.trim();
      if (head.startsWith("@layer")) stack.push("layer");
      else if (head.startsWith("@")) stack.push("at");
      else {
        // Każdy człon listy sprawdzamy OSOBNO: w `:where(input), .custom-input`
        // pierwszy człon ma zerową specyficzność i sam w sobie odtwarza
        // regresję kaskady, choć cała lista jako całość już nie.
        const offender =
          !inLayer() && !inDeclarations() && head
            ? splitSelectorList(head).find(hasZeroSpecificity)
            : undefined;
        if (offender !== undefined) {
          found.push({
            line: preludeLine,
            selector: offender.replace(/\s+/g, " ").slice(0, 160),
          });
        }
        stack.push("rule");
      }
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (ch === ";" && !inDeclarations()) {
      // Statement, np. `@layer theme, base;` albo `@import …;`
      prelude = "";
      preludeLine = line;
      continue;
    }
    if (!prelude.trim() && ch.trim()) preludeLine = line;
    prelude += ch;
  }
  return found;
}
