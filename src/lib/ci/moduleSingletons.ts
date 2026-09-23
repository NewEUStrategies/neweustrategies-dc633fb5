/**
 * Strażnik jednej kopii: pakiety, które trzymają stan na poziomie modułu albo
 * rozpoznają własne obiekty przez `instanceof`, muszą istnieć w drzewie
 * zależności w JEDNEJ fizycznej kopii.
 *
 * PROBLEM, KTÓRY TO ŁAPIE
 * `bun.lock` pamięta zagnieżdżone instalacje (`pakiet-a/pakiet-b`) także wtedy,
 * gdy wersja wyniesiona na górę drzewa dawno spełnia zakres pakietu `a`. Każdy
 * taki wpis to DRUGA kopia modułu: osobne zmienne modułu, osobne klasy, osobne
 * konteksty Reacta. Niczego to nie psuje przy instalacji ani przy typowaniu,
 * a psuje w działaniu - i dopiero w konkretnym połączeniu zdarzeń:
 *   - 2026-09-22, PR #389: dwie kopie `@radix-ui/react-dismissable-layer`
 *     i `@radix-ui/react-focus-scope`. Każda kopia miała własny stos warstw
 *     i własny licznik strażników fokusu, więc okno otwarte z wnętrza innego
 *     okna zamykało się przy pierwszym kliknięciu (wybierak mediów, pasek
 *     reakcji w czacie).
 *   - 2026-09-22, PR #390: zagnieżdżona kopia `@babel/traverse` pod
 *     `babel-dead-code-elimination`. Wtyczka dzieląca trasy przekazywała
 *     ścieżki AST z jednej kopii do drugiej, a pamięć podręczna ścieżek jest
 *     zmienną modułu - siedem stron przestało się ładować.
 * Oba przypadki były niewidoczne aż do pierwszego czerwonego przebiegu e2e.
 * Ta bramka zamienia je w komunikat przy `bun install` i w czerwony krok CI.
 *
 * INWARIANT
 * Każdy pakiet z `SINGLETON_PACKAGES` występuje w sekcji `packages` pliku
 * `bun.lock` pod dokładnie jedną ścieżką instalacji - poza wpisami z jawnej
 * listy `DUPLICATE_ALLOWLIST`, z których każdy ma zapisany powód. Wpis listy,
 * który przestał być potrzebny, też jest błędem: lista może się tylko kurczyć.
 *
 * DLACZEGO LICZYMY ŚCIEŻKI, A NIE WERSJE. Dwie ścieżki z TĄ SAMĄ wersją to
 * nadal dwa katalogi w `node_modules`, a bundler i Node rozwiązują moduł po
 * ścieżce - więc to nadal dwie kopie stanu.
 *
 * i18n: brak treści dla użytkownika - narzędzie CI.
 */

/** Jedna ścieżka instalacji z sekcji `packages` pliku `bun.lock`. */
export interface LockPackage {
  /** Klucz sekcji `packages`, np. "prosemirror-tables/prosemirror-view". */
  path: string;
  /** Nazwa pakietu, np. "prosemirror-view". */
  name: string;
  /** Rozwiązana wersja albo źródło, np. "1.41.8". */
  version: string;
}

/** Pakiet, którego druga kopia ma skutki w działaniu, i opis tych skutków. */
export interface SingletonRule {
  /** Dokładna nazwa pakietu albo zakres zakończony "/*", np. "@radix-ui/*". */
  match: string;
  /** Co psuje druga kopia - trafia do komunikatu bramki. */
  why: string;
}

/** Świadomy wyjątek: ta ścieżka instalacji MOŻE być drugą kopią. */
export interface AllowedDuplicate {
  path: string;
  reason: string;
}

/** Pakiet z więcej niż jedną ścieżką instalacji. */
export interface SingletonDuplicate {
  name: string;
  rule: SingletonRule;
  copies: LockPackage[];
}

export interface SingletonReport {
  duplicates: SingletonDuplicate[];
  /** Wpisy listy wyjątków, których ścieżka nie jest już drugą kopią. */
  staleAllowlist: AllowedDuplicate[];
}

export const SINGLETON_PACKAGES: readonly SingletonRule[] = [
  {
    match: "react",
    why: "dwa dyspozytory hooków - „Invalid hook call” i konteksty niewidoczne między kopiami",
  },
  { match: "react-dom", why: "dwa renderery na jednym drzewie Reacta" },
  { match: "scheduler", why: "dwie kolejki priorytetów dla jednego renderera" },
  {
    match: "@radix-ui/*",
    why: "osobne konteksty, stos warstw i licznik strażników fokusu - okno w oknie zamyka się przy pierwszym kliknięciu (PR #389)",
  },
  {
    match: "@tiptap/*",
    why: "rozszerzenia edytora rozpoznają się przez klasy i klucze wtyczek jednej kopii",
  },
  {
    match: "prosemirror-model",
    why: "węzły i fragmenty z innej kopii nie przechodzą `instanceof` - „multiple versions of prosemirror-model”",
  },
  {
    match: "prosemirror-state",
    why: "zaznaczenia i klucze wtyczek z innej kopii nie są rozpoznawane przez stan edytora",
  },
  {
    match: "prosemirror-view",
    why: "`DecorationGroup.from` sprawdza `instanceof DecorationSet` - zestaw z innej kopii wnosi `undefined` do grupy dekoracji",
  },
  {
    match: "prosemirror-transform",
    why: "kroki transakcji z innej kopii nie są rozpoznawane przy mapowaniu i scalaniu",
  },
  {
    match: "@tanstack/react-query",
    why: "dwa konteksty `QueryClient` - zapytania nie widzą klienta",
  },
  { match: "@tanstack/query-core", why: "dwie pamięci podręczne zapytań" },
  { match: "@tanstack/react-router", why: "dwa konteksty routera" },
  { match: "@tanstack/router-core", why: "dwa rdzenie routera w jednym drzewie tras" },
  { match: "i18next", why: "dwie instancje tłumaczeń - teksty w języku, którego nikt nie wybrał" },
  { match: "react-i18next", why: "dwa konteksty tłumaczeń" },
  {
    match: "@babel/core",
    why: "wtyczki przekazują sobie AST między kopiami - dzielenie tras gubi kod (PR #390)",
  },
  {
    match: "@babel/traverse",
    why: "pamięć podręczna ścieżek i zasięgów jest zmienną modułu - siedem stron przestało się ładować (PR #390)",
  },
];

/**
 * Ścieżki instalacji, które MOGĄ być drugą kopią. Pusta lista znaczy „żadna
 * druga kopia nie jest dziś świadomie tolerowana". Nowy wpis wymaga powodu,
 * który tłumaczy, dlaczego ta kopia nigdy nie spotka obiektów z pierwszej.
 */
export const DUPLICATE_ALLOWLIST: readonly AllowedDuplicate[] = [];

/**
 * Parser JSON z przecinkami na końcu list i obiektów - w tym formacie bun
 * zapisuje `bun.lock`. Przecinek jest usuwany wyłącznie POZA napisami, więc
 * treść pól (np. skrypty `bin`) zostaje nietknięta.
 */
export function parseLockfileJson(text: string): unknown {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

/**
 * Rozdziela specyfikację `nazwa@wersja`. Nazwa z zakresu zaczyna się od "@",
 * więc separatorem jest PIERWSZA małpa po pierwszym znaku - wersja bywa
 * adresem z własnymi małpami (`xlsx@https://…`).
 */
export function splitSpec(spec: string): { name: string; version: string } {
  const at = spec.indexOf("@", 1);
  if (at <= 0) return { name: spec, version: "" };
  return { name: spec.slice(0, at), version: spec.slice(at + 1) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Wszystkie ścieżki instalacji z sekcji `packages` pliku `bun.lock`. */
export function lockPackages(lockText: string): LockPackage[] {
  const lock = parseLockfileJson(lockText);
  if (!isRecord(lock) || !isRecord(lock.packages)) {
    throw new Error("bun.lock: brak sekcji `packages` - zmienił się format pliku blokady");
  }
  const out: LockPackage[] = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const { name, version } = splitSpec(entry[0]);
    out.push({ path, name, version });
  }
  return out;
}

/** Reguła, której podlega pakiet, albo `undefined`, gdy pakiet nie jest pilnowany. */
export function ruleFor(
  name: string,
  rules: readonly SingletonRule[] = SINGLETON_PACKAGES,
): SingletonRule | undefined {
  return rules.find((rule) =>
    rule.match.endsWith("/*") ? name.startsWith(rule.match.slice(0, -1)) : name === rule.match,
  );
}

export function findSingletonDuplicates(
  packages: readonly LockPackage[],
  rules: readonly SingletonRule[] = SINGLETON_PACKAGES,
  allowlist: readonly AllowedDuplicate[] = DUPLICATE_ALLOWLIST,
): SingletonReport {
  const allowed = new Set(allowlist.map((entry) => entry.path));
  const byName = new Map<string, { rule: SingletonRule; copies: LockPackage[] }>();
  for (const pkg of packages) {
    const rule = ruleFor(pkg.name, rules);
    if (rule === undefined) continue;
    const group = byName.get(pkg.name) ?? { rule, copies: [] };
    group.copies.push(pkg);
    byName.set(pkg.name, group);
  }

  const duplicates: SingletonDuplicate[] = [];
  const stillDuplicated = new Set<string>();
  for (const [name, { rule, copies }] of byName) {
    if (copies.length < 2) continue;
    for (const copy of copies) stillDuplicated.add(copy.path);
    // Kopia wyniesiona na górę drzewa (ścieżka = nazwa) nigdy nie jest
    // „tą drugą" - wyjątek może dotyczyć wyłącznie ścieżek zagnieżdżonych.
    const unexplained = copies.filter((copy) => copy.path !== name && !allowed.has(copy.path));
    if (unexplained.length === 0) continue;
    duplicates.push({
      name,
      rule,
      copies: [...copies].sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  duplicates.sort((a, b) => a.name.localeCompare(b.name));
  const staleAllowlist = allowlist.filter((entry) => !stillDuplicated.has(entry.path));
  return { duplicates, staleAllowlist };
}

export function singletonCheckFailed(report: SingletonReport): boolean {
  return report.duplicates.length > 0 || report.staleAllowlist.length > 0;
}

export function renderSingletonReport(report: SingletonReport): string {
  if (!singletonCheckFailed(report)) {
    return `[module-singletons] OK - każdy pilnowany pakiet ma w bun.lock jedną kopię (${SINGLETON_PACKAGES.length} reguł).`;
  }
  const lines: string[] = [];
  if (report.duplicates.length > 0) {
    lines.push(
      `[module-singletons] ✗ ${report.duplicates.length} pakiet(ów) ze stanem modułu ma w bun.lock więcej niż jedną kopię:`,
    );
    for (const dup of report.duplicates) {
      lines.push("", `  ${dup.name} - ${dup.rule.why}`);
      for (const copy of dup.copies) lines.push(`    ${copy.version.padEnd(12)} ${copy.path}`);
    }
    lines.push(
      "",
      "  JAK NAPRAWIĆ. Jeśli wersja z góry drzewa spełnia zakres pakietu nadrzędnego, zagnieżdżony",
      "  wpis jest pozostałością - usuń jego linie z bun.lock i uruchom `bun install`. Jeśli nie",
      "  spełnia, wyrównaj wersje (podbij zależność albo dodaj `overrides` w package.json).",
      "  Wyjątek w DUPLICATE_ALLOWLIST (src/lib/ci/moduleSingletons.ts) tylko z powodem, dlaczego",
      "  ta kopia nigdy nie spotka obiektów z pierwszej.",
    );
  }
  if (report.staleAllowlist.length > 0) {
    lines.push(
      "",
      "[module-singletons] ✗ Wyjątki, które nie są już potrzebne - usuń je z DUPLICATE_ALLOWLIST:",
    );
    for (const entry of report.staleAllowlist) lines.push(`    ${entry.path}`);
  }
  return lines.join("\n");
}
