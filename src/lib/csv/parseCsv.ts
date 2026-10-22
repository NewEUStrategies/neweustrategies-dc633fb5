// Wspólny parser CSV dla dialogów importu (newsletter, CRM).
//
// Wydzielony z ImportCsvDialog newslettera, żeby oba moduły dzieliły jedną,
// przetestowaną implementację. Prosty i przewidywalny: cudzysłowy w stylu
// RFC 4180 ("" = literalny cudzysłów), separator , lub ; wykrywany po tym,
// którego jest więcej w wierszu nagłówka (poza cudzysłowami), \r ignorowane.
// Parser jest czysty - limity wierszy egzekwują warstwy wyżej.

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  /**
   * Numer rekordu każdego wiersza `rows` w pliku (1 = pierwszy rekord, licząc
   * puste linie) - numer, który użytkownik zobaczy w arkuszu, gdy dialog
   * zgłasza błąd wiersza (pominięte puste linie nie przesuwają numeracji).
   */
  rowNumbers: number[];
}

/** Separator , lub ; - wygrywa częstszy w PIERWSZEJ linii poza cudzysłowami. */
export function detectCsvDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semis = 0;
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQ = !inQ;
    else if (!inQ && c === "\n") break;
    else if (!inQ && c === ",") commas++;
    else if (!inQ && c === ";") semis++;
  }
  return semis > commas ? ";" : ",";
}

export function parseCsv(text: string): ParsedCsv {
  const delim = detectCsvDelimiter(text);
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQ = false;
      else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === delim) {
        cur.push(field);
        field = "";
      } else if (c === "\n") {
        cur.push(field);
        field = "";
        lines.push(cur);
        cur = [];
      } else if (c === "\r") {
        /* skip */
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    lines.push(cur);
  }
  const nonEmpty = lines
    .map((record, index) => ({ record, number: index + 1 }))
    .filter(({ record }) => record.some((v) => v.trim().length));
  const header = nonEmpty[0]?.record ?? [];
  const data = nonEmpty.slice(1);
  return {
    header,
    rows: data.map(({ record }) => record),
    rowNumbers: data.map(({ number }) => number),
  };
}
