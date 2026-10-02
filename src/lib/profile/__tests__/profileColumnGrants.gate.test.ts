// Bramka: klientowy select na `profiles` nie może
// wymieniać kolumny BEZ grantu SELECT dla roli `authenticated`.
//
// CO TO ZA RYZYKO. Kolumny prywatne (`phone`, `location`, `gender`,
// `current_company_id`, `email`, ...) celowo nie mają grantu - polityka odczytu
// wpuszcza staff do cudzych wierszy tenanta, więc grant kolumnowy jest jedyną
// zaporą. PostgREST nie oddaje wtedy pustej kolumny: odrzuca CAŁE zapytanie
// kodem 42501. Ani `tsc` (wygenerowane typy znają kolumnę), ani atrapa łańcucha
// w testach jednostkowych (odda to, co jej zaplanowano) tego nie widzą. Tak
// pulpit /profile i miernik kompletności wstawały puste przy KAŻDYM wejściu,
// a testy były zielone.
//
// DLACZEGO STATYCZNIE. Dowód integracyjny wymagałby realnej bazy z grantami;
// ta bramka czyta KOD i przenosi błąd z przeglądarki użytkownika do review.
// Własny wiersz z tymi kolumnami czyta się przez `fetchOwnProfileRow()`
// (`get_own_profile()`, SECURITY DEFINER zawężony do `auth.uid()`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OWNER_ONLY_PROFILE_COLUMNS } from "../ownProfile";

/**
 * Wszystkie pliki klienckie w `src/` (bez testów i modułów serwerowych).
 *
 * Cały `src/`, nie tylko powierzchnia profilu: własny wiersz czytają też
 * panele spoza niej (podgląd „jako ja" w studiu wydarzeń, przełącznik
 * ukrycia awatara w czacie), a 42501 psuje je tak samo.
 */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__" && name !== "test") walk(path);
        continue;
      }
      // `*.server.ts` chodzi kluczem service_role - granty kolumnowe go nie
      // dotyczą, więc nie jest przedmiotem tej bramki.
      // `*.functions.ts` to funkcje serwerowe - chodzą klientem, którego rolę
      // rozstrzyga ich middleware, nie ta bramka.
      if (/\.(ts|tsx)$/.test(name) && !/\.(server|test|functions)\.tsx?$/.test(name)) {
        out.push(path);
      }
    }
  };
  walk("src");
  return out;
}

interface ProfileSelect {
  readonly file: string;
  readonly line: number;
  /** Lista kolumn po rozwiązaniu stałej; `null` = argumentu nie da się odczytać. */
  readonly columns: string[] | null;
  readonly raw: string;
}

/** Literał napisu (bez interpolacji) albo `null`. */
function literal(text: string): string | null {
  const m = /^\s*(["'`])([^"'`$]*)\1/.exec(text);
  return m ? m[2] : null;
}

function columnsOf(selection: string): string[] {
  // Osadzone relacje (`user_roles(role)`) to kolumny INNYCH tabel - wycinamy
  // je przed podziałem po przecinku. Alias `a:kolumna` i rzutowanie `::text`
  // nie zmieniają tego, którą kolumnę `profiles` adresuje zapytanie.
  return selection
    .replace(/[a-z_!:]+\([^)]*\)/gi, "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/^[a-z_]+:/i, "").replace(/::[a-z_]+$/i, ""));
}

/**
 * Komentarze wycięte z zachowaniem liczby wierszy (numer linii w raporcie ma
 * trafiać w kod). Komentarz `//` liczy się tylko po białym znaku albo na
 * początku wiersza - `https://` w literale zostaje nietknięty.
 */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Pierwszy argument `.select(`: cały literał napisu albo identyfikator. */
const SELECT_CALL =
  /\.from\(\s*["']profiles["']\s*\)\s*\.select\(\s*("[^"]*"|'[^']*'|`[^`]*`|[A-Za-z_$][\w$]*)/g;

/** Każde `.from("profiles")...select(<arg>)` w źródle, ze stałą rozwiązaną w pliku. */
function profileSelects(file: string, rawSrc: string): ProfileSelect[] {
  const src = withoutComments(rawSrc);
  const found: ProfileSelect[] = [];
  for (const m of src.matchAll(SELECT_CALL)) {
    const arg = m[1].trim();
    let selection = literal(arg);
    if (selection === null && /^[A-Za-z_$][\w$]*$/.test(arg)) {
      const decl = new RegExp(`const\\s+${arg}\\s*(?::[^=]+)?=\\s*([\\s\\S]*?);`).exec(src);
      selection = decl ? literal(decl[1]) : null;
    }
    found.push({
      file,
      line: src.slice(0, m.index).split("\n").length,
      columns: selection === null ? null : columnsOf(selection),
      raw: arg,
    });
  }
  return found;
}

const OWNER_ONLY = new Set<string>(OWNER_ONLY_PROFILE_COLUMNS);

/**
 * Znane naruszenia sprzed rozszerzenia bramki na cały `src/`, każde z powodem.
 * Lista może tylko maleć: wpis, który przestał naruszać, oblewa samokontrolę
 * niżej. Nowego wpisu nie dodaje się zamiast poprawki.
 */
// Pusta od 2026-10-02: awatary leadów CRM idą już serwerem (3a656f1), więc
// `admin.crm.index.tsx` przestał czytać `email` / `contact_email` cudzych
// profili, a samokontrola niżej kazała zdjąć jego wpis.
const KNOWN_VIOLATIONS: Readonly<Record<string, string>> = {};

describe("klientowe selecty na `profiles` tylko z kolumn z grantem", () => {
  const all = sourceFiles().flatMap((file) => profileSelects(file, readFileSync(file, "utf8")));

  it("bramka w ogóle WIDZI selecty (kontrola pozytywna)", () => {
    // Bez tego zmiana kształtu wywołań (np. inny klient) dałaby zero dopasowań
    // i zieloną bramkę, która niczego nie sprawdza.
    expect(all.some((q) => q.file.endsWith("useHeaderProfile.ts"))).toBe(true);
  });

  it("każdy select ma czytelną listę kolumn (literał albo stała w pliku)", () => {
    // Selekcja składana w locie (`[...].join(", ")`, interpolacja) jest dla
    // bramki nieprzejrzysta - i dla przeglądu też.
    const opaque = all.filter((q) => q.columns === null).map((q) => `${q.file}:${q.line} ${q.raw}`);
    expect(opaque).toEqual([]);
  });

  it("żaden select nie prosi o `*` - to wciąga kolumny bez grantu i kończy się 42501", () => {
    const star = all
      .filter((q) => q.columns?.some((c) => c.includes("*")))
      .map((q) => `${q.file}:${q.line}`);
    expect(star).toEqual([]);
  });

  it("żaden select nie wymienia kolumny prywatnej - te czyta się przez `get_own_profile()`", () => {
    const leaks = all
      .filter((q) => !(q.file in KNOWN_VIOLATIONS))
      .flatMap((q) =>
        (q.columns ?? [])
          .filter((c) => OWNER_ONLY.has(c))
          .map((c) => `${q.file}:${q.line} -> ${c}`),
      );
    expect(leaks).toEqual([]);
  });

  it("każdy znany wyjątek nadal narusza - poprawiony wpis trzeba usunąć z listy", () => {
    const stale = Object.keys(KNOWN_VIOLATIONS).filter(
      (file) => !all.some((q) => q.file === file && q.columns?.some((c) => OWNER_ONLY.has(c))),
    );
    expect(stale).toEqual([]);
  });

  it("bramka ŁAPIE dawny select edytora przez stałą (samokontrola)", () => {
    // Dokładnie ten kształt przeszedł kiedyś przez review: stała z listą kolumn
    // i `.select(FIELDS)`. Bramka, która go nie łapie, nie broni przed niczym.
    const src = [
      'const FIELDS = "display_name, phone, location, gender, current_company_id";',
      'supabase.from("profiles").select(FIELDS).eq("id", uid);',
    ].join("\n");
    const [q] = profileSelects("synthetic.ts", src);
    expect(q?.columns?.filter((c) => OWNER_ONLY.has(c))).toEqual([
      "phone",
      "location",
      "gender",
      "current_company_id",
    ]);
  });

  it("lista kolumn prywatnych nie jest KRÓTSZA niż kontrakt pgTAP", () => {
    // pgTAP (`supabase/tests/*.sql`) dowodzi braku grantu na żywej bazie.
    // Kolumna, której brak grantu jest tam asertowany, a której nie ma
    // w `OWNER_ONLY_PROFILE_COLUMNS`, przeszłaby przez tę bramkę bez słowa.
    const dir = "supabase/tests";
    const asserted = new Set<string>();
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql"))) {
      const sql = readFileSync(join(dir, name), "utf8");
      for (const m of sql.matchAll(
        /NOT has_column_privilege\('authenticated',\s*'public\.profiles',\s*'([a-z_]+)'/g,
      )) {
        asserted.add(m[1]);
      }
    }
    expect(asserted.size).toBeGreaterThan(0);
    expect([...asserted].filter((c) => !OWNER_ONLY.has(c))).toEqual([]);
  });
});
