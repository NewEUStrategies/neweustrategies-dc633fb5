// PODZIAL ZA DUZEJ MIGRACJI NA CZESCI - warstwa czysta (bez I/O).
//
// PRZYCZYNA ZRODLOWA. Migracje tego repozytorium wdraza panel Lovable, a on NIE
// przyjmuje duzych plikow: wdrozyl 52 653 B
// (`drizzle/migrations/0057_event_group_guests_follow_lead.sql`), a pliki od
// 62 KB do 199 KB odrzucil z komunikatem "the files are too large and cannot be
// split". Pisanie migracji "na raty" recznie konczy sie zawsze tak samo: ciecie
// w srodku ciala funkcji cytowanego dolarami, zgubiony `;`, `REVOKE` w innym
// pliku niz `CREATE FUNCTION` albo tabela bez RLS w czesci, ktora wjechala bez
// swojej nastepczyni. Ten modul tnie MECHANICZNIE i sam dowodzi, ze nic nie
// zgubil.
//
// JAK TNIE. Lekser zna skladnie PostgreSQL w zakresie, ktory decyduje o granicy
// instrukcji: literal '...' z escape `''`, literal E'...' z escape `\`, cytowany
// identyfikator "..." z escape `""`, ciala $tag$...$tag$ z dowolnym tagiem
// (zagniezdzony INNY tag jest trescia), komentarz `--` i ZAGNIEZDZONY `/* */`,
// a do tego dwie reguly psql: `;` w nawiasie nie konczy instrukcji, a w
// `CREATE [OR REPLACE] FUNCTION|PROCEDURE ... BEGIN ATOMIC ... END` - tez nie.
// Granica czesci wypada WYLACZNIE miedzy instrukcjami najwyzszego poziomu.
// Komentarz przed instrukcja jedzie razem z nia (to jej opis), komentarz za `;`
// w tej samej linii zostaje przy poprzedniej.
//
// CZEGO NIE ROZDZIELA (grupy nierozlaczne). Czesci wdrazaja sie OSOBNO, wiec
// miedzy nimi jest okno - sekundy albo godziny, a przy bledzie nastepnej czesci
// nawet stan trwaly. Dlatego instrukcje, ktore w oknie zostawilyby baze mniej
// szczelna albo bez obiektu, laduja w jednej czesci z tym, czego dotycza:
//   * `ALTER TABLE t ENABLE|FORCE ROW LEVEL SECURITY`, `REVOKE ... ON t` oraz
//     `ALTER VIEW v ...` - z `CREATE TABLE|VIEW` tego obiektu albo z `ALTER
//     TABLE t ADD COLUMN` (inaczej tabela czy nowa kolumna wisi w API bez RLS
//     i z domyslnymi grantami Supabase dla `anon`); kazde kolejne uszczelnienie
//     siega do PIERWSZEGO utworzenia, bo REVOKE od `anon` bez REVOKE od
//     `authenticated` to nadal przeciek;
//   * `REVOKE ... ON FUNCTION f` i `ALTER FUNCTION f` - z `CREATE FUNCTION f`
//     (inaczej SECURITY DEFINER jest wykonywalna przez PUBLIC);
//   * `DROP X` - z nastepujacym po nim `CREATE X` tego samego obiektu (idiom
//     "DROP POLICY IF EXISTS p; CREATE POLICY p" - bez tego polityki nie ma,
//     a polityka RESTRICTIVE, ktorej nie ma, to WIECEJ dostepu, nie mniej;
//     tak samo trigger-straznik zdjety i nie postawiony z powrotem), a takze
//     `ALTER TABLE t DROP CONSTRAINT c` z `ADD CONSTRAINT c` (w oknie CHECK
//     nie pilnuje danych, a zly wiersz wywroci nastepna czesc) i `DISABLE
//     TRIGGER|ROW LEVEL SECURITY` z odpowiadajacym `ENABLE`;
//   * instrukcja SESYJNA (`SET`, `RESET`, `BEGIN`/`COMMIT`, `LOCK`,
//     `CREATE TEMP ...`, `set_config(...)`) - ze WSZYSTKIM, co po niej: jej
//     skutek zyje tylko w sesji albo transakcji, ktora konczy sie z czescia;
//   * instrukcja przyklejona do poprzedniej bez odstepu (`a;b`) - zob. nizej.
// Za duza grupa to blad z linia i powodem sklejenia, a nie ciche ciecie.
//
// DOWOD. `splitAligned` na koncu wola `verifySplit` i rzuca, gdy ktorykolwiek
// warunek nie zachodzi: (1) SQL wykonywalny czesci sklejony w kolejnosci ==
// SQL wykonywalny oryginalu, liczony TA SAMA funkcja, ktora porownuje pasy
// (`executableSql` z migrationLaneParity.ts - nie reimplementujemy jej, bo
// dowod mialby wtedy dwie definicje "tego samego SQL-a"); (2) czesci bez
// naglowka i stopki sklejone w kolejnosci == oryginal BAJT W BAJT; (3) kazda
// czesc (z naglowkiem) miesci sie w limicie bajtow UTF-8; (4) przy dwoch
// pasach czesc k pasa drizzle ma ten sam SQL wykonywalny, co czesc k pasa
// supabase - czyli kazda para czesci jest od razu blizniakiem dla
// `check:migration-lanes`.
//
// DLACZEGO `a;b` JEST NIEROZLACZNE. `executableSql` zwiera bialy znak do
// jednej spacji, ale go nie dopisuje. Czesci skleja sie spacja, wiec granica
// bez zadnego odstepu w oryginale dalaby `a; b` wobec `a;b` - dowod (1)
// pekalby na pliku, ktory jest poprawny. Taki styl nie wystepuje w repo;
// zamiast oslabiac dowod, nie tniemy w tym miejscu.
import { executableSql } from "./migrationLaneParity";

/** Domyslny limit czesci: 45 KiB. Lovable wdrozyl 52 653 B, odrzucil 62 KB+. */
export const DEFAULT_MAX_BYTES = 45 * 1024;

/** Jedna instrukcja najwyzszego poziomu razem z komentarzem przed nia. */
export interface SqlSegment {
  /** Dokladny tekst segmentu (sklejenie wszystkich segmentow == zrodlo). */
  readonly text: string;
  /** Poczatek segmentu w zrodle (indeks znaku). */
  readonly start: number;
  /** Indeks pierwszego znaku kodu albo -1 dla pliku z samych komentarzy. */
  readonly codeStart: number;
  /** Linia (od 1) pierwszego znaku kodu - do komunikatow bledow. */
  readonly line: number;
  /** Czy instrukcja konczy sie `;` (ostatnia w pliku moze nie miec). */
  readonly terminated: boolean;
  /**
   * Kod instrukcji bez komentarzy, ze zwarta spacja i trescia literalow oraz
   * cial dolarowych zastapiona znacznikiem - do rozpoznania, czego dotyczy.
   * Cytowane identyfikatory zostaja bajt w bajt (to sa nazwy obiektow).
   */
  readonly skeleton: string;
}

/** Blad skladni, przez ktory nie da sie wyznaczyc granic instrukcji. */
export class MigrationLexError extends Error {
  constructor(what: string, line: number) {
    super(`Niezamkniety ${what} od linii ${line} - nie da sie wyznaczyc granic instrukcji.`);
    this.name = "MigrationLexError";
  }
}

/** Podzialu nie da sie wykonac albo nie przeszedl wlasnego dowodu. */
export class MigrationSplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationSplitError";
  }
}

const IDENT_START = /[A-Za-z_\u0080-\uFFFF]/;
const IDENT_CONT = /[A-Za-z0-9_$\u0080-\uFFFF]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/y;
const SPACE = /\s/;
/** Po `;`: spacje, opcjonalny komentarz `--` i koniec linii zostaja przy instrukcji. */
const SAME_LINE_TAIL = /[ \t]*(?:--[^\n]*)?(?:\r?\n|$)/y;
/** Slowa, ktore psql zapamietuje, zeby rozpoznac `CREATE [OR REPLACE] FUNCTION|PROCEDURE`. */
const ROUTINE_WORDS = new Set(["create", "function", "procedure", "or", "replace"]);

/** Dopasowanie wyrazenia `sticky` dokladnie od pozycji `at` (bez kopiowania zrodla). */
function matchAt(re: RegExp, src: string, at: number): string | null {
  re.lastIndex = at;
  const m = re.exec(src);
  return m ? m[0] : null;
}

/**
 * Numer linii (od 1) dla indeksu - liczony przyrostowo, bo segmentow sa setki.
 * Lekser pyta wylacznie o indeksy niemalejace (kolejne segmenty, potem miejsce
 * bledu za nimi), wiec licznik nigdy nie cofa sie po tekscie.
 */
function lineCounter(src: string): (index: number) => number {
  let pos = 0;
  let line = 1;
  return (index) => {
    for (; pos < index; pos += 1) if (src[pos] === "\n") line += 1;
    return line;
  };
}

/** Koniec literalu zaczynajacego sie cudzyslowem `quote` na `at`; podwojenie to escape. */
function quotedEnd(src: string, at: number, quote: string, backslash: boolean): number {
  let j = at + 1;
  while (j < src.length) {
    const ch = src[j];
    if (backslash && ch === "\\") {
      j += 2;
      continue;
    }
    if (ch === quote) {
      if (src[j + 1] !== quote) return j + 1;
      j += 2;
      continue;
    }
    j += 1;
  }
  return -1;
}

/** Koniec zagniezdzonego komentarza blokowego zaczynajacego sie na `at`. */
function blockCommentEnd(src: string, at: number): number {
  let depth = 0;
  let j = at;
  while (j < src.length) {
    if (src[j] === "/" && src[j + 1] === "*") {
      depth += 1;
      j += 2;
    } else if (src[j] === "*" && src[j + 1] === "/") {
      depth -= 1;
      j += 2;
      if (depth === 0) return j;
    } else {
      j += 1;
    }
  }
  return -1;
}

/**
 * Dzieli migracje na instrukcje najwyzszego poziomu. Sklejenie `text`
 * wszystkich segmentow daje zrodlo bajt w bajt. Komentarze za ostatnia
 * instrukcja naleza do niej; segment z samych komentarzy (`codeStart === -1`)
 * powstaje wylacznie dla pliku, w ktorym nie ma ani jednej instrukcji.
 */
export function lexStatements(src: string): SqlSegment[] {
  const lineAt = lineCounter(src);
  const segments: SqlSegment[] = [];
  let segStart = 0;
  let codeStart = -1;
  let skeleton = "";
  let parenDepth = 0;
  let beginDepth = 0;
  let identCount = 0;
  let firsts = ["", "", "", ""];
  let spaced = false;
  let i = 0;

  const code = (piece: string): void => {
    if (codeStart === -1) codeStart = i;
    skeleton += spaced && skeleton !== "" ? ` ${piece}` : piece;
    spaced = false;
  };

  const emit = (end: number, terminated: boolean): void => {
    segments.push({
      text: src.slice(segStart, end),
      start: segStart,
      codeStart,
      line: lineAt(codeStart === -1 ? segStart : codeStart),
      terminated,
      skeleton,
    });
    segStart = end;
    codeStart = -1;
    skeleton = "";
    parenDepth = 0;
    beginDepth = 0;
    identCount = 0;
    firsts = ["", "", "", ""];
  };

  /** Heurystyka psql: BEGIN/CASE/END liczone tylko w `CREATE ... FUNCTION|PROCEDURE`. */
  const word = (w: string): void => {
    const lower = w.toLowerCase();
    if (identCount < 4 && ROUTINE_WORDS.has(lower)) firsts[identCount] = lower[0]!;
    identCount += 1;
    const routine =
      firsts[0] === "c" &&
      (firsts[1] === "f" ||
        firsts[1] === "p" ||
        (firsts[1] === "o" && firsts[2] === "r" && (firsts[3] === "f" || firsts[3] === "p")));
    if (!routine || parenDepth > 0) return;
    if (lower === "begin") beginDepth += 1;
    else if (lower === "case" && beginDepth >= 1) beginDepth += 1;
    else if (lower === "end" && beginDepth > 0) beginDepth -= 1;
  };

  while (i < src.length) {
    const ch = src[i]!;

    if (ch === "-" && src[i + 1] === "-") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      spaced = true;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = blockCommentEnd(src, i);
      if (end === -1) throw new MigrationLexError("komentarz /* */", lineAt(i));
      i = end;
      spaced = true;
      continue;
    }
    if (SPACE.test(ch)) {
      i += 1;
      spaced = true;
      continue;
    }

    // Litera na tym poziomie petli zawsze ZACZYNA slowo (reszte slowa zjada galaz
    // identyfikatora nizej), wiec `E'` tutaj to prefiks literalu, a `somE'x'`
    // to nazwa `somE` i zwykly literal - dokladnie jak w lekserze PostgreSQL.
    if (ch === "'" || ((ch === "E" || ch === "e") && src[i + 1] === "'")) {
      const open = ch === "'" ? i : i + 1;
      const end = quotedEnd(src, open, "'", open !== i);
      if (end === -1) throw new MigrationLexError("literal '...'", lineAt(i));
      code("''");
      i = end;
      continue;
    }
    if (ch === '"') {
      const end = quotedEnd(src, i, '"', false);
      if (end === -1) throw new MigrationLexError('identyfikator "..."', lineAt(i));
      code(src.slice(i, end));
      i = end;
      continue;
    }
    // `$` po nazwie (`a$b$`) nalezy do nazwy i zjada go galaz identyfikatora,
    // wiec tu `$` zawsze stoi na poczatku tokenu: cialo dolarowe albo `$1`.
    if (ch === "$") {
      const tag = matchAt(DOLLAR_TAG, src, i);
      if (tag) {
        const close = src.indexOf(tag, i + tag.length);
        if (close === -1) throw new MigrationLexError(`cialo ${tag}`, lineAt(i));
        code("$$");
        i = close + tag.length;
        continue;
      }
    }
    if (IDENT_START.test(ch)) {
      let j = i + 1;
      while (j < src.length && IDENT_CONT.test(src[j]!)) j += 1;
      const w = src.slice(i, j);
      code(w);
      word(w);
      i = j;
      continue;
    }
    code(ch);
    i += 1;
    if (ch === "(") parenDepth += 1;
    else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    else if (ch === ";" && parenDepth === 0 && beginDepth === 0) {
      const tail = matchAt(SAME_LINE_TAIL, src, i);
      emit(i + (tail === null ? 0 : tail.length), true);
      i = segStart;
    }
  }

  if (segStart < src.length) {
    const last = segments[segments.length - 1];
    if (codeStart === -1 && last !== undefined) {
      // Same komentarze za ostatnim `;` - stopka pliku, nie instrukcja.
      segments[segments.length - 1] = { ...last, text: last.text + src.slice(segStart) };
    } else {
      emit(src.length, false);
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// CZEGO DOTYCZY INSTRUKCJA - do grup nierozlacznych
// ---------------------------------------------------------------------------

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_$\u0080-\uFFFF]*)`;
const QNAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})?`;
const IDENT_G = new RegExp(IDENT, "g");
const QNAME_ONLY = new RegExp(String.raw`^${QNAME}$`);

function rx(source: string): RegExp {
  return new RegExp(source, "i");
}

const RE_SESSION = rx(
  String.raw`^(?:SET|RESET|BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|PREPARE|DECLARE|DISCARD|LISTEN|UNLISTEN|LOCK)\b|^CREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?TEMP(?:ORARY)?\b|^SELECT\s+(?:pg_catalog\s*\.\s*)?set_config\s*\(`,
);
const RE_CREATE_REL = rx(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?(?:RECURSIVE\s+)?(?:MATERIALIZED\s+)?(?:TABLE|VIEW|SEQUENCE)\s+(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})`,
);
const RE_CREATE_ROUTINE = rx(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(${QNAME})\s*\(`,
);
const RE_CREATE_POLICY = rx(String.raw`^CREATE\s+POLICY\s+(${IDENT})\s+ON\s+(${QNAME})`);
const RE_CREATE_TRIGGER = rx(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER\s+(${IDENT})\s[\s\S]*?\bON\s+(${QNAME})`,
);
const RE_CREATE_INDEX = rx(
  String.raw`^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(${QNAME})\s+ON\b`,
);
const RE_DROP = rx(
  String.raw`^DROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|SEQUENCE|FUNCTION|PROCEDURE|POLICY|TRIGGER|INDEX)\s+(?:CONCURRENTLY\s+)?(?:IF\s+EXISTS\s+)?(${QNAME})(?:\s*\([^)]*\))?(?:\s+ON\s+(${QNAME}))?`,
);
const RE_ALTER_TABLE = rx(
  String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(${QNAME})\s+([\s\S]*)$`,
);
/** Akcje `ALTER TABLE` (po szkielecie: literaly i ciala sa juz zamaskowane). */
const ALTER_ACTIONS: readonly {
  readonly re: RegExp;
  readonly list: "creates" | "drops";
  readonly key: (table: string, name: string | undefined) => string;
}[] = [
  // Nowa kolumna dziedziczy granty tabeli - pozniejszy REVOKE na tabeli ja uszczelnia.
  {
    re: /\bADD\s+(?!(?:CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b)/gi,
    list: "creates",
    key: (t) => `rel:${t}`,
  },
  {
    re: new RegExp(String.raw`\bADD\s+CONSTRAINT\s+(${IDENT})`, "gi"),
    list: "creates",
    key: (t, c) => `constraint:${t}|${objectName(c!)}`,
  },
  {
    re: new RegExp(String.raw`\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(${IDENT})`, "gi"),
    list: "drops",
    key: (t, c) => `constraint:${t}|${objectName(c!)}`,
  },
  {
    re: new RegExp(String.raw`\bENABLE\s+(?:ALWAYS\s+|REPLICA\s+)?TRIGGER\s+(${IDENT})`, "gi"),
    list: "creates",
    key: (t, c) => `trigger-on:${t}|${objectName(c!)}`,
  },
  {
    re: new RegExp(String.raw`\bDISABLE\s+TRIGGER\s+(${IDENT})`, "gi"),
    list: "drops",
    key: (t, c) => `trigger-on:${t}|${objectName(c!)}`,
  },
  {
    re: /(?<!\bNO\s+)\b(?:ENABLE|FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi,
    list: "creates",
    key: (t) => `rls:${t}`,
  },
  {
    re: /\b(?:DISABLE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY/gi,
    list: "drops",
    key: (t) => `rls:${t}`,
  },
];
const RE_ALTER_VIEW = rx(
  String.raw`^ALTER\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+EXISTS\s+)?(${QNAME})`,
);
const RE_ALTER_ROUTINE = rx(String.raw`^ALTER\s+(?:FUNCTION|PROCEDURE|ROUTINE)\s+(${QNAME})\s*\(`);
const RE_REVOKE = rx(
  String.raw`^REVOKE\s[\s\S]*?\bON\s+(?:(TABLE|SEQUENCE|FUNCTION|PROCEDURE|ROUTINE)\s+)?([\s\S]*?)\s+FROM\s`,
);

/** Klucz obiektu: nazwy bez cudzyslowow (te w cudzyslowie z zachowana wielkoscia), schemat domyslny `public`. */
export function objectName(raw: string): string {
  const parts = raw.match(IDENT_G)!;
  const norm = parts.map((p) =>
    p.startsWith('"') ? p.slice(1, -1).replace(/""/g, '"') : p.toLowerCase(),
  );
  return (norm.length === 1 ? ["public", ...norm] : norm).join(".");
}

/** Co instrukcja robi z obiektami - na potrzeby grup nierozlacznych. */
export interface StatementEffect {
  /** Zmienia stan SESJI/transakcji: wszystko po niej musi jechac razem z nia. */
  readonly session: boolean;
  /**
   * Obiekty tworzone albo przywracane (`rel:`, `routine:`, `policy:`,
   * `trigger:`, `index:`, `constraint:`, `trigger-on:`, `rls:`); `rel:` takze
   * przy `ADD COLUMN` - nowa kolumna dziedziczy granty tabeli.
   */
  readonly creates: readonly string[];
  /** Obiekty zdejmowane albo wylaczane - do sklejenia z najblizszym CREATE tego samego klucza. */
  readonly drops: readonly string[];
  /** Obiekty uszczelniane (RLS, REVOKE, ALTER) - do sklejenia z ich CREATE. */
  readonly secures: readonly string[];
}

const DROP_KIND: Readonly<Record<string, string>> = {
  TABLE: "rel",
  VIEW: "rel",
  "MATERIALIZED VIEW": "rel",
  SEQUENCE: "rel",
  FUNCTION: "routine",
  PROCEDURE: "routine",
  POLICY: "policy",
  TRIGGER: "trigger",
  INDEX: "index",
};

/** Lista obiektow z `REVOKE ... ON <lista> FROM` - bez sygnatur, tylko nazwy. */
function revokeTargets(kind: string | undefined, list: string): string[] {
  const prefix = kind === undefined || /^(?:TABLE|SEQUENCE)$/i.test(kind) ? "rel" : "routine";
  return list
    .replace(/\((?:[^()]|\([^()]*\))*\)/g, "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => QNAME_ONLY.test(item))
    .map((item) => `${prefix}:${objectName(item)}`);
}

/** Rozpoznaje, czego dotyczy instrukcja (po szkielecie z `lexStatements`). */
export function statementEffect(skeleton: string): StatementEffect {
  const creates: string[] = [];
  const drops: string[] = [];
  const secures: string[] = [];
  let m: RegExpExecArray | null;

  if ((m = RE_CREATE_REL.exec(skeleton))) creates.push(`rel:${objectName(m[1]!)}`);
  else if ((m = RE_CREATE_ROUTINE.exec(skeleton))) creates.push(`routine:${objectName(m[1]!)}`);
  else if ((m = RE_CREATE_POLICY.exec(skeleton)))
    creates.push(`policy:${objectName(m[2]!)}|${objectName(m[1]!)}`);
  else if ((m = RE_CREATE_TRIGGER.exec(skeleton)))
    creates.push(`trigger:${objectName(m[2]!)}|${objectName(m[1]!)}`);
  else if ((m = RE_CREATE_INDEX.exec(skeleton))) creates.push(`index:${objectName(m[1]!)}`);
  else if ((m = RE_DROP.exec(skeleton))) {
    const kind = DROP_KIND[m[1]!.toUpperCase().replace(/\s+/g, " ")]!;
    drops.push(
      m[3] === undefined
        ? `${kind}:${objectName(m[2]!)}`
        : `${kind}:${objectName(m[3])}|${objectName(m[2]!)}`,
    );
  } else if ((m = RE_ALTER_TABLE.exec(skeleton))) {
    const table = objectName(m[1]!);
    const actions = m[2]!;
    const out = { creates, drops };
    for (const action of ALTER_ACTIONS) {
      for (const hit of actions.matchAll(action.re)) {
        const key = action.key(table, hit[1]);
        if (!out[action.list].includes(key)) out[action.list].push(key);
      }
    }
    if (creates.includes(`rls:${table}`)) secures.push(`rel:${table}`);
  } else if ((m = RE_ALTER_VIEW.exec(skeleton))) secures.push(`rel:${objectName(m[1]!)}`);
  else if ((m = RE_ALTER_ROUTINE.exec(skeleton))) secures.push(`routine:${objectName(m[1]!)}`);
  else if ((m = RE_REVOKE.exec(skeleton))) secures.push(...revokeTargets(m[1], m[2]!));

  return { session: RE_SESSION.test(skeleton), creates, drops, secures };
}

/**
 * Dla kazdej granicy (przed segmentem k, k >= 1) powod, dla ktorego NIE WOLNO
 * tam ciac, albo `null`, gdy wolno. Indeks 0 jest zawsze `null` (nie granica).
 */
export function boundaryLocks(segments: readonly SqlSegment[]): (string | null)[] {
  const locks: (string | null)[] = segments.map(() => null);
  const lock = (from: number, to: number, why: string): void => {
    for (let k = from + 1; k <= to; k += 1) locks[k] ??= why;
  };
  // "Epizod" obiektu: od PIERWSZEGO utworzenia/rozszerzenia do ostatniego
  // uszczelnienia. Kazdy REVOKE/RLS epizodu siega do jego poczatku (REVOKE od
  // `anon`, a potem od `authenticated` - okno miedzy nimi to tez przeciek);
  // nowy epizod zaczyna dopiero CREATE po uszczelnieniu (np. druga wersja
  // funkcji z wlasnym REVOKE), inaczej plik z kilkoma wersjami funkcji
  // skleilby sie w jedna nierozcinalna grupe.
  const episodes = new Map<string, { at: number; sealed: boolean }>();
  const pendingDrop = new Map<string, number>();

  segments.forEach((seg, k) => {
    const prev = segments[k - 1];
    if (prev !== undefined && !/\s$/.test(prev.text) && seg.codeStart === seg.start) {
      lock(k - 1, k, `brak odstepu po ';' w linii ${prev.line}`);
    }
    const effect = statementEffect(seg.skeleton);
    if (effect.session) {
      lock(
        k,
        segments.length - 1,
        `instrukcja sesyjna w linii ${seg.line} obowiazuje do konca pliku`,
      );
    }
    for (const key of effect.drops) if (!pendingDrop.has(key)) pendingDrop.set(key, k);
    for (const key of effect.creates) {
      if (episodes.get(key)?.sealed !== false) episodes.set(key, { at: k, sealed: false });
      const at = pendingDrop.get(key);
      if (at !== undefined) {
        lock(
          at,
          k,
          `${key} zdejmowany w linii ${segments[at]!.line} i tworzony na nowo w linii ${seg.line}`,
        );
        pendingDrop.delete(key);
      }
    }
    for (const key of effect.secures) {
      const episode = episodes.get(key);
      if (episode === undefined) continue;
      lock(
        episode.at,
        k,
        `${key} utworzony w linii ${segments[episode.at]!.line} i uszczelniany w linii ${seg.line}`,
      );
      episode.sealed = true;
    }
  });
  return locks;
}

// ---------------------------------------------------------------------------
// PAKOWANIE I DOWOD
// ---------------------------------------------------------------------------

/** Rozmiar w bajtach UTF-8 bez alokowania bufora. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let k = 0; k < text.length; k += 1) {
    const c = text.charCodeAt(k);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      bytes += 4;
      k += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** Jeden pas migracji do pociecia (supabase, opcjonalnie jego blizniak drizzle). */
export interface LaneSource {
  readonly sql: string;
  /** Naglowek czesci k (2..n) z n: czysty komentarz SQL zakonczony znakiem "\n". */
  readonly header: (k: number, n: number) => string;
  /** Stopka czesci 1 z n: czysty komentarz SQL (pusty = brak stopki). */
  readonly trailer: (n: number) => string;
}

export interface SplitPart {
  /** Pelna tresc pliku czesci. */
  readonly text: string;
  /** Dlugosc (w znakach) wygenerowanego naglowka na poczatku `text`. */
  readonly head: number;
  /** Dlugosc (w znakach) wygenerowanej stopki na koncu `text`. */
  readonly tail: number;
  readonly bytes: number;
}

export interface SplitResult {
  /** `lanes[l][k]` - czesc k pasa l (kolejnosc pasow jak na wejsciu). */
  readonly lanes: readonly (readonly SplitPart[])[];
  /** Indeksy czesci ponad limitem - tylko w trybie `onOversize: "isolate"`. */
  readonly oversize: readonly number[];
  /** Liczba instrukcji najwyzszego poziomu. */
  readonly statements: number;
  /** Numer linii (w pasie 0) pierwszej instrukcji kazdej czesci. */
  readonly firstLines: readonly number[];
}

export interface SplitOptions {
  readonly maxBytes?: number;
  /**
   * `throw` (domyslnie): grupa nierozlaczna ponad limitem to blad.
   * `isolate`: taka grupa staje sie osobna czescia ponad limitem i trafia do
   * `oversize` - do pomiarow (test wlasnosci), nie do wdrozenia.
   */
  readonly onOversize?: "throw" | "isolate";
}

function unchanged(
  lanes: readonly LaneSource[],
  statements: number,
  oversize: readonly number[],
): SplitResult {
  return {
    lanes: lanes.map((lane) => [{ text: lane.sql, head: 0, tail: 0, bytes: utf8Length(lane.sql) }]),
    oversize,
    statements,
    firstLines: [1],
  };
}

function snippet(skeleton: string): string {
  return skeleton.length > 80 ? `${skeleton.slice(0, 77)}...` : skeleton;
}

/**
 * Tnie pasy migracji na czesci <= `maxBytes` (UTF-8, z naglowkiem), w tych
 * samych miejscach we wszystkich pasach, i sprawdza wynik `verifySplit`.
 * Plik, ktory sie miesci (we wszystkich pasach), wraca bez zmian.
 */
export function splitAligned(
  lanes: readonly LaneSource[],
  options: SplitOptions = {},
): SplitResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lexed = lanes.map((lane) => lexStatements(lane.sql));
  const base = lexed[0]!;
  if (lanes.every((lane) => utf8Length(lane.sql) <= maxBytes)) {
    return unchanged(lanes, base.length, []);
  }

  lexed.forEach((segs, l) => {
    const mismatch = base.findIndex(
      (seg, k) => segs[k] === undefined || executableSql(seg.text) !== executableSql(segs[k].text),
    );
    if (mismatch !== -1 || segs.length !== base.length) {
      const k = mismatch === -1 ? base.length : mismatch;
      throw new MigrationSplitError(
        `Pas ${l} nie jest zgodny z pasem 0 instrukcja po instrukcji (instrukcja #${k + 1}, linia ${base[k]?.line ?? "-"} w pasie 0). Blizniak musi miec ten sam SQL wykonywalny w tej samej kolejnosci.`,
      );
    }
  });

  // Grupy nierozlaczne: granica jest zablokowana, gdy blokuje ja KTORYKOLWIEK pas.
  const locks = lexed.map(boundaryLocks);
  const units: { from: number; to: number; why: string[] }[] = [];
  base.forEach((_, k) => {
    const why = locks.map((l) => l[k]).find((w): w is string => w != null);
    const unit = units[units.length - 1];
    if (unit !== undefined && why !== undefined) {
      unit.to = k + 1;
      if (!unit.why.includes(why)) unit.why.push(why);
    } else {
      units.push({ from: k, to: k + 1, why: [] });
    }
  });

  const unitBytes = units.map((u) =>
    lexed.map((segs) => segs.slice(u.from, u.to).reduce((sum, s) => sum + utf8Length(s.text), 0)),
  );
  const nMax = units.length;
  const headerReserve = lanes.map((lane) => {
    let worst = 0;
    for (let k = 2; k <= nMax; k += 1) worst = Math.max(worst, utf8Length(lane.header(k, nMax)));
    return worst;
  });
  const trailerReserve = lanes.map((lane) => utf8Length(lane.trailer(nMax)) + 1);
  const budget = (partIndex: number, l: number): number =>
    maxBytes - (partIndex === 0 ? trailerReserve[l]! : headerReserve[l]!);

  const packs: { from: number; to: number; bytes: number[] }[] = [];
  const oversize: number[] = [];
  units.forEach((unit, u) => {
    const cur = packs[packs.length - 1];
    const sizes = unitBytes[u]!;
    if (cur !== undefined && !oversize.includes(packs.length - 1)) {
      const fits = sizes.every((b, l) => cur.bytes[l]! + b <= budget(packs.length - 1, l));
      if (fits) {
        cur.to = unit.to;
        cur.bytes = cur.bytes.map((b, l) => b + sizes[l]!);
        return;
      }
    }
    const index = packs.length;
    if (sizes.some((b, l) => b > budget(index, l))) {
      if (options.onOversize !== "isolate") {
        const seg = base[unit.from]!;
        const lastLine = base[unit.to - 1]!.line;
        throw new MigrationSplitError(
          `Instrukcja${unit.to - unit.from > 1 ? ` z grupa nierozlaczna (linie ${seg.line}-${lastLine})` : ` w linii ${seg.line}`} ma ${Math.max(...sizes)} B i nie miesci sie w czesci o limicie ${maxBytes} B (z naglowkiem). Poczatek: "${snippet(seg.skeleton)}".${unit.why.length > 0 ? ` Sklejone, bo: ${unit.why.slice(0, 3).join("; ")}.` : ""} Podziel te instrukcje recznie albo podnies --max-kb.`,
        );
      }
      oversize.push(index);
    }
    packs.push({ from: unit.from, to: unit.to, bytes: [...sizes] });
  });

  // Jedna czesc przy pliku ponad limit = jedna grupa nierozlaczna ponad limit
  // (tryb `isolate`); plik zostaje w calosci, a `oversize` mowi o tym wprost.
  const n = packs.length;
  if (n === 1) return unchanged(lanes, base.length, oversize);

  const result: SplitResult = {
    lanes: lanes.map((lane, l) =>
      packs.map((pack, k): SplitPart => {
        const body = lexed[l]!.slice(pack.from, pack.to)
          .map((s) => s.text)
          .join("");
        const trailer = lane.trailer(n);
        const head = k === 0 ? "" : lane.header(k + 1, n);
        const tail = k !== 0 || trailer === "" ? "" : (body.endsWith("\n") ? "" : "\n") + trailer;
        const text = head + body + tail;
        return { text, head: head.length, tail: tail.length, bytes: utf8Length(text) };
      }),
    ),
    oversize,
    statements: base.length,
    firstLines: packs.map((pack) => base[pack.from]!.line),
  };

  const problems = verifySplit(
    lanes.map((lane) => lane.sql),
    result,
    maxBytes,
  );
  if (problems.length > 0) {
    throw new MigrationSplitError(
      `Podzial nie przeszedl wlasnego dowodu:\n  ${problems.join("\n  ")}`,
    );
  }
  return result;
}

/**
 * Dowod podzialu - lista naruszen (pusta = dowod przeszedl):
 *   (1) SQL wykonywalny czesci sklejony spacja == SQL wykonywalny oryginalu;
 *   (2) czesci bez naglowka/stopki sklejone == oryginal bajt w bajt;
 *   (3) kazda czesc (poza jawnie odlozonymi w `oversize`) <= `maxBytes`;
 *   (4) czesc k kazdego pasa ma ten sam SQL wykonywalny, co czesc k pasa 0.
 */
export function verifySplit(
  sources: readonly string[],
  result: SplitResult,
  maxBytes: number,
): string[] {
  const problems: string[] = [];
  const reference = result.lanes[0]!;
  result.lanes.forEach((parts, l) => {
    const source = sources[l]!;
    const bodies = parts.map((p) => p.text.slice(p.head, p.text.length - p.tail)).join("");
    if (bodies !== source) {
      problems.push(`pas ${l}: czesci bez naglowkow nie skladaja sie w oryginal bajt w bajt`);
    }
    const joined = parts.map((p) => executableSql(p.text)).join(" ");
    if (joined !== executableSql(source)) {
      problems.push(`pas ${l}: SQL wykonywalny czesci rozni sie od SQL-a wykonywalnego oryginalu`);
    }
    if (parts.length !== reference.length) {
      problems.push(`pas ${l}: ${parts.length} czesci wobec ${reference.length} w pasie 0`);
    }
    parts.forEach((p, k) => {
      if (!result.oversize.includes(k) && utf8Length(p.text) > maxBytes) {
        problems.push(`pas ${l}, czesc ${k + 1}: ${utf8Length(p.text)} B > limit ${maxBytes} B`);
      }
      const twin = reference[k];
      if (twin !== undefined && executableSql(p.text) !== executableSql(twin.text)) {
        problems.push(`pas ${l}, czesc ${k + 1}: SQL wykonywalny rozny od czesci ${k + 1} pasa 0`);
      }
    });
  });
  return problems;
}
