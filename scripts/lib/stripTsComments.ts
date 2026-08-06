/**
 * Usuwa komentarze z zrodla TypeScript/TSX, ZACHOWUJAC uklad linii.
 *
 * Po co (bramka `check-sql-app-role-literals.ts`, 2026-08-06). Skanery
 * statyczne szukajace wzorcow w kodzie klienta dostawaly falszywe trafienia z
 * DOKUMENTACJI: JSDoc parsera bramek cytuje `has_role(uid, 'X')` jako wzorzec do
 * dopasowania, a nie jako wywolanie. Dla plikow `.sql` gate od poczatku scinal
 * komentarze (`stripSqlComments`); dla `.ts`/`.tsx` nie mial czym. Efekt: krok
 * `SQL app_role literal invariant` byl czerwony na mainie z powodu wlasnego
 * komentarza.
 *
 * Zachowanie ukladu linii jest wymagane: gate raportuje `plik:linia`, wiec
 * kazdy usuniety znak zastepujemy spacja, a `\n` przepisujemy 1:1.
 *
 * Obsluguje: `//`, ostring-y `'`/`"`, szablony `` ` `` (wraz z `${}`)
 * oraz literaly wyrazen regularnych - bez nich `/['"]/` przewracalby stan
 * cudzyslowu i psul cala reszte pliku.
 */

/** Znaki, po ktorych `/` zaczyna literal regexpa, a nie dzielenie. */
const REGEX_ALLOWED_PREFIX = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";"]);

function startsRegex(source: string, slashIndex: number): boolean {
  for (let i = slashIndex - 1; i >= 0; i -= 1) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") continue;
    if (REGEX_ALLOWED_PREFIX.has(ch)) return true;
    // `return /re/`, `typeof /re/` itd. - slowo kluczowe tuz przed ukosnikiem.
    const word = /[A-Za-z_$]/.test(ch) ? source.slice(0, i + 1).match(/[A-Za-z_$]+$/)?.[0] : null;
    return word === "return" || word === "typeof" || word === "case" || word === "in";
  }
  return true; // poczatek pliku
}

export function stripTsComments(source: string): string {
  let out = "";
  let i = 0;

  const blank = (ch: string): void => {
    out += ch === "\n" ? "\n" : " ";
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Komentarz liniowy.
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        blank(source[i]);
        i += 1;
      }
      continue;
    }

    // Komentarz blokowy.
    if (ch === "/" && next === "*") {
      blank(" ");
      blank(" ");
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        blank(source[i]);
        i += 1;
      }
      if (i < source.length) {
        blank(" ");
        blank(" ");
        i += 2;
      }
      continue;
    }

    // Literal regexpa - przepisujemy w calosci, zeby jego zawartosc nie mieszala
    // sie ze stanem cudzyslowow.
    if (ch === "/" && startsRegex(source, i)) {
      out += ch;
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const c = source[i];
        out += c;
        i += 1;
        if (c === "\\") {
          if (i < source.length) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
        else if (c === "\n") break; // niedomkniety - nie zjadaj reszty pliku
      }
      continue;
    }

    // String / szablon - przepisywany dokladnie (gate szuka w nim literalow).
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        out += c;
        i += 1;
        if (c === "\\") {
          if (i < source.length) {
            out += source[i];
            i += 1;
          }
          continue;
        }
        if (c === quote) break;
        // Zwykly string konczy sie na nowej linii (niedomkniety) - szablon nie.
        if (c === "\n" && quote !== "`") break;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
