/**
 * Usuwanie komentarzy z TypeScriptu/JavaScriptu dla bramek STATYCZNYCH.
 *
 * PO CO: bramki skanujace repo wzorcem (np. `has_role(uid, 'rola')` w
 * check-sql-app-role-literals) traktowaly `.ts/.tsx` jako goly tekst, wiec
 * wywalaly sie na WLASNEJ DOKUMENTACJI - komentarz cytujacy naprawiany literal
 * liczyl sie jak zywe wywolanie. Bramka, ktora czerwieni CI za opis defektu,
 * uczy tylko jednego: nie opisywac defektow.
 *
 * Odpowiednik `stripSqlComments` z ./sqlMigrations dla drugiego jezyka repo.
 * Parser jest znakowy (nie regexowy), bo `//` i `/*` w literale tekstowym
 * (`"https://…"`, `'/*'`) nie sa komentarzami - naiwne wyciecie zjadaloby kod i
 * dawalo falszywe NEGATYWY, czyli dokladnie to, czego bramka ma nie robic.
 * Podstawienie spacji zamiast usuniecia zachowuje numery linii i kolumn, wiec
 * komunikaty bramek nadal wskazuja to samo miejsce w pliku.
 */
export function stripTsComments(source: string): string {
  let out = "";
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    // Komentarz liniowy - do konca linii (sam znak nowej linii zostaje).
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }

    // Komentarz blokowy - nowe linie zachowujemy, resztę zamieniamy na spacje.
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      for (let j = i; j < stop; j += 1) out += source[j] === "\n" ? "\n" : " ";
      i = stop;
      continue;
    }

    // Literaly: '…', "…", `…` (z escape'ami i interpolacja w szablonach).
    if (ch === "'" || ch === '"' || ch === "`") {
      out += ch;
      i += 1;
      while (i < source.length) {
        const inner = source[i];
        if (inner === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += inner;
        i += 1;
        if (inner === ch) break;
        // Literal jednoznakowy nie przechodzi przez nowa linie - bez tego
        // niedomknięty apostrof (np. w polskim „nie" w komentarzu, ktory juz
        // wycielismy) zjadalby resztę pliku.
        if (inner === "\n" && ch !== "`") break;
      }
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}
