// Inwariant CI: WYGENEROWANE TYPY NIE ODSTAJĄ OD MIGRACJI.
//
// PRZYCZYNA ŹRÓDŁOWA - I POWÓD, DLA KTÓREGO REPO MA 349 `as unknown as`.
// `src/integrations/supabase/types.ts` jest generowany z bazy. Migracje są
// forward-only i jest ich 760. Gdy ktoś doda kolumnę migracją i nie zregeneruje
// typów, kod czytający tę kolumnę NIE KOMPILUJE SIĘ - i wtedy najtańszym
// wyjściem jest `as unknown as JakiśRow` z ręcznie przepisanym kształtem.
// Cast działa, ale od tej chwili kasuje KAŻDĄ różnicę między kodem a bazą -
// także tę, która pojawi się rok później. Czyli: nieświeże typy PRODUKUJĄ
// casty, a casty ukrywają kolejne rozjazdy. Bramka wchodzi na początek tego
// łańcucha.
//
// STAN ZMIERZONY PRZY WDROŻENIU: 28 kolumn z 11 tabel istnieje w migracjach
// i nie ma ich w wygenerowanych typach. Cztery z nich to `tenant_id`
// (`research_program_items`, `_members`, `_partners`, `_projects`) - czyli
// kolumna, na której stoi izolacja najemców. Kod, który ma ją ustawić, nie
// może tego zrobić w sposób typowany.
//
// DLACZEGO BASELINE, A NIE ZERO. Regeneracja `types.ts` wymaga dostępu do
// projektu Supabase (CLI + klucz), więc nie jest zmianą, którą wolno zrobić
// „po drodze" w PR o czymś innym: przepisuje 20 tysięcy linii wygenerowanego
// pliku i dotyka każdego zapytania w repo. Bramka zamraża dług na dokładnej
// liście i oblewa, gdy ktoś dopisze kolumnę BEZ regeneracji. Lista ma tylko
// maleć - i zniknąć w całości przy najbliższej regeneracji.
//
// CZEGO NIE MIERZY - świadomie:
//   * kolumn z `CREATE TABLE` - te wchodzą do typów razem z tabelą, a tabela
//     bez typów w ogóle się nie skompiluje, więc nie umie zniknąć po cichu;
//   * typów kolumn (`text` vs `uuid`) - do tego trzeba pełnego parsera DDL,
//     a pytanie „czy kolumna w ogóle jest" łapie tę klasę błędu najtaniej;
//   * widoków i RPC - istnienie obiektów pilnuje `check:db-contract`.
//
// ── DLACZEGO SKANER ZNA `RENAME` (korekta 2026-08-14) ──────────────────────
// Pierwsza wersja czytała wyłącznie `ADD COLUMN` i `DROP COLUMN`, więc zbiór
// „kolumn żywych po migracjach" rozjeżdżał się ze stanem końcowym w obie strony
// - i oba kierunki realnie wystąpiły w tym repo:
//
//   * FAŁSZYWY DŁUG. `member_organizations.paddle_subscription_id` wjechało
//     `ADD COLUMN` (20260729204314) i zostało PRZEMIANOWANE na
//     `provider_subscription_id` (20260805134721, migracja na Stripe). Kolumny
//     o starej nazwie nie ma w bazie od dziesięciu dni, a bramka nadal jej
//     wymagała - wpis siedział w zamrożonym długu i BLOKOWAŁ CI z całkiem
//     innego miejsca: `check:legacy-payment-refs` widział w nim jedyną żywą
//     referencję do poprzedniego operatora płatności w całym repo. Dwie dobre
//     bramki stały sobie w gardle, bo jedna liczyła fantom.
//
//   * FAŁSZYWY SPOKÓJ - klasa groźniejsza. Nazwa PO przemianowaniu nie była
//     mierzona wcale: `subscriptions.provider_subscription_id` powstało właśnie
//     z `RENAME COLUMN`, nie z `ADD COLUMN` (pierwotnie było w `CREATE TABLE`).
//     Gdyby typy nie zdążyły za tą migracją, kod czytający nową nazwę nie
//     kompilowałby się, a bramka postawiona dokładnie po to milczałaby.
//     Zwolnienie dla `CREATE TABLE` nie ma tu zastosowania: tabela istnieje
//     w typach od dawna, więc nic się samo nie wywali.
//
// Dlatego `RENAME COLUMN` ustawia nową nazwę jako żywą NAWET wtedy, gdy starej
// nie było w zbiorze - to jedyny sposób, by objąć kolumny z `CREATE TABLE`,
// które przeszły przez rename. `RENAME TO` (tabela) tylko PRZENOSI wpisy już
// zebrane; nie dokłada nowych, bo świeża nazwa tabeli nadal podlega zwolnieniu
// z akapitu wyżej.
//
// ── DLACZEGO SKANER ZNA `DROP TABLE` (korekta 2026-08-15) ──────────────────
// Ta sama klasa co wyżej, o piętro wyżej: odtwarzanie znało śmierć KOLUMNY
// (`DROP COLUMN`), ale nie znało śmierci TABELI. Kolumny skasowanej tabeli
// zostawały więc w zbiorze „żywych" na zawsze - fantom nie do zbicia migracją,
// bo nie ma czego dodać ani przemianować, żeby zniknął.
//
// Wystąpiło realnie: `research_programs` przestało być tabelą w 20260815110844
// (model przeniesiony do `public.programs`, `DROP TABLE public.research_programs`,
// a nazwa wróciła jako WIDOK nad `programs`). Wpis `research_programs.created_by`
// przetrwał w zamrożonym długu i oblewał bramkę jako `resolved` - dług zniknął,
// ale z niewłaściwego powodu: przypadkiem, bo widok o tej samej nazwie wnosi tę
// kolumnę do wygenerowanych typów. Gdyby model przenieśli bez widoku, ten sam
// wpis stałby w liście jako wieczny dług nieistniejącej tabeli.
//
// ANKROWANIE DO POCZĄTKU INSTRUKCJI JEST TU CAŁĄ TREŚCIĄ, nie kosmetyką.
// Napis `DROP TABLE` pada w tym repo w trzech różnych znaczeniach i tylko jedno
// kasuje tabelę:
//   * `ALTER PUBLICATION supabase_realtime DROP TABLE public.crm_leads` - to
//     wypisanie z publikacji replikacji, tabela żyje dalej. Naiwny wzorzec
//     „gdziekolwiek `DROP TABLE`" skasowałby tu SIEDEM żywych tabel (m.in.
//     `crm_leads`, `newsletter_subscribers`, `contact_messages`) i uciszył
//     bramkę dokładnie tam, gdzie ma krzyczeć - fałszywy spokój, klasa
//     groźniejsza od fałszywego długu;
//   * `EXECUTE 'DROP TABLE public.suppressed_emails'` - drop dynamiczny w bloku
//     `DO`. Świadomie NIE liczony: rozbiór SQL-a w napisie wymagałby drugiego
//     parsera, a pominięcie myli się w stronę bezpieczną (zostaje ewentualny
//     fałszywy dług, który widać i da się zdjąć z listy ręcznie).
// Dlatego zdarzenie powstaje wyłącznie wtedy, gdy `DROP TABLE` OTWIERA
// instrukcję - poprzedza je początek pliku albo `;`.
//
// Kolejność wewnątrz jednej migracji ma znaczenie (`DROP TABLE x; CREATE TABLE x;
// ALTER TABLE x ADD COLUMN y`), a `ALTER`-y i `DROP`-y zbierają dwa niezależne
// przebiegi wzorców. Dlatego zdarzenia są sortowane pozycją instrukcji w pliku,
// a nie kolejnością przebiegów.

/** Migracja poddana skanowi (nazwa pliku + treść). */
export interface ScannedMigration {
  readonly file: string;
  readonly sql: string;
}

/** Kolumna dopisana migracją, której nie ma w wygenerowanych typach. */
export interface StaleColumn {
  readonly table: string;
  readonly column: string;
  /** Migracja, która ją dodała - żeby review wiedziało, od kiedy jest dług. */
  readonly file: string;
}

/** Kolumny zadeklarowane w wygenerowanych typach, per tabela. */
export type GeneratedColumns = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * `Row` każdej tabeli z wygenerowanych typów.
 *
 * Parsujemy WYŁĄCZNIE blok `Row: {` na ustalonym wcięciu - `Insert` i `Update`
 * opisują to samo innymi modyfikatorami, a `Relationships` to już nie kolumny.
 */
export function readGeneratedColumns(types: string): GeneratedColumns {
  const out = new Map<string, Set<string>>();
  const table = /\n {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/g;
  let match = table.exec(types);
  while (match !== null) {
    const columns = new Set<string>();
    for (const line of match[2].split("\n")) {
      const column = /^\s+([a-z0-9_]+)\??:/.exec(line);
      if (column !== null) columns.add(column[1]);
    }
    out.set(match[1], columns);
    match = table.exec(types);
  }
  return out;
}

/** Usuwa komentarze liniowe, żeby zakomentowany `ADD COLUMN` nie liczył się. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, "");
}

/**
 * Zdarzenie DDL istotne dla zbioru żywych kolumn. Unia dyskryminowana, żeby
 * dopisanie kolejnego rodzaju nie dało się przeoczyć w odtwarzaniu (`switch`
 * bez gałęzi przestaje się kompilować).
 */
export type ColumnEvent =
  | { readonly kind: "add"; readonly table: string; readonly column: string; readonly file: string }
  | {
      readonly kind: "drop";
      readonly table: string;
      readonly column: string;
      readonly file: string;
    }
  | {
      readonly kind: "rename-column";
      readonly table: string;
      readonly from: string;
      readonly to: string;
      readonly file: string;
    }
  | {
      readonly kind: "rename-table";
      readonly from: string;
      readonly to: string;
      readonly file: string;
    }
  | { readonly kind: "drop-table"; readonly table: string; readonly file: string };

/** `ALTER TABLE … RENAME TO nowa` - przemianowanie TABELI, nie kolumny. */
const RENAME_TABLE_RE = /\bRENAME\s+TO\s+"?([a-z0-9_]+)"?/i;
/** `ALTER TABLE … RENAME [COLUMN] stara TO nowa`. Słowo COLUMN jest w PG opcjonalne. */
const RENAME_COLUMN_RE = /\bRENAME\s+(?:COLUMN\s+)?"?([a-z0-9_]+)"?\s+TO\s+"?([a-z0-9_]+)"?/i;
/**
 * `DROP TABLE [IF EXISTS] a, public.b [CASCADE]` OTWIERAJĄCE instrukcję.
 *
 * `(?:^|;)` to cały mechanizm odsiewania `ALTER PUBLICATION … DROP TABLE`
 * i `EXECUTE '…'` - uzasadnienie w nagłówku modułu. Bez flagi `m`: `^` ma
 * znaczyć początek PLIKU, nie początek linii, bo instrukcja zawinięta do
 * następnej linii (`ALTER PUBLICATION x\n  DROP TABLE y`) też ma nie trafiać.
 */
const DROP_TABLE_RE = /(?:^|;)\s*DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^;]+)/gi;

/** Nazwy tabel z listy jednego `DROP TABLE` - bez schematu, bez `CASCADE`. */
function dropTableTargets(list: string): string[] {
  const names: string[] = [];
  for (const item of list.replace(/\s+(?:CASCADE|RESTRICT)\s*$/i, "").split(",")) {
    const name = /(?:^|\.)"?([a-z0-9_]+)"?\s*$/i.exec(item.trim());
    if (name !== null) names.push(name[1]);
  }
  return names;
}

/**
 * Zdarzenia kolumnowe ze wszystkich `ALTER TABLE` i `DROP TABLE`, w kolejności
 * migracji, a wewnątrz migracji - w kolejności instrukcji w pliku.
 * Kolejność ma znaczenie: kolumna dodana i później skreślona nie jest długiem
 * typów, kolumna przemianowana jest długiem pod NOWĄ nazwą, a po skasowaniu
 * tabeli nie ma długu żadna z jej kolumn.
 *
 * `ALTER INDEX … RENAME TO` (a takich w repo jest kilkanaście przy okazji
 * przemianowań tabel) nie wchodzi tu w ogóle - wzorzec zaczyna się od
 * `ALTER TABLE`. `ALTER PUBLICATION … DROP TABLE` odsiewa ankrowanie
 * `DROP_TABLE_RE` do początku instrukcji.
 */
export function scanColumnEvents(migrations: readonly ScannedMigration[]): ColumnEvent[] {
  const out: ColumnEvent[] = [];
  for (const { file, sql } of migrations) {
    const clean = stripLineComments(sql);
    // Pozycja instrukcji w pliku, nie kolejność przebiegu wzorca: `ALTER`-y
    // i `DROP TABLE` zbierają dwa niezależne skany, a odtwarzanie w
    // `findStaleColumns` jest wrażliwe na kolejność. Sort jest stabilny, więc
    // zdarzenia z JEDNEJ instrukcji zachowują kolejność dopisania.
    const found: { readonly at: number; readonly event: ColumnEvent }[] = [];

    const alters = clean.matchAll(
      /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?"?([a-z0-9_]+)"?([\s\S]*?);/gi,
    );
    for (const alter of alters) {
      const at = alter.index;
      const table = alter[1];
      const body = alter[2];
      for (const add of body.matchAll(/ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        found.push({ at, event: { kind: "add", table, column: add[1], file } });
      }
      for (const drop of body.matchAll(/DROP COLUMN\s+(?:IF EXISTS\s+)?"?([a-z0-9_]+)"?/gi)) {
        found.push({ at, event: { kind: "drop", table, column: drop[1], file } });
      }
      // Kolejność testów jest istotna: `RENAME TO x` pasuje TYLKO do tabeli,
      // a wzorzec kolumnowy sprawdzamy dopiero, gdy tabelowy nie trafił -
      // inaczej `RENAME CONSTRAINT`/`RENAME TO` mogłyby dać zdarzenie widmo.
      const renamedTable = RENAME_TABLE_RE.exec(body);
      if (renamedTable !== null) {
        found.push({ at, event: { kind: "rename-table", from: table, to: renamedTable[1], file } });
        continue;
      }
      const renamedColumn = RENAME_COLUMN_RE.exec(body);
      if (renamedColumn !== null) {
        found.push({
          at,
          event: {
            kind: "rename-column",
            table,
            from: renamedColumn[1],
            to: renamedColumn[2],
            file,
          },
        });
      }
    }

    for (const dropped of clean.matchAll(DROP_TABLE_RE)) {
      for (const table of dropTableTargets(dropped[1])) {
        found.push({ at: dropped.index, event: { kind: "drop-table", table, file } });
      }
    }

    found.sort((a, b) => a.at - b.at);
    for (const { event } of found) out.push(event);
  }
  return out;
}

/**
 * Kolumny żywe po migracjach, których nie ma w wygenerowanych typach.
 *
 * Tabele nieznane typom są pomijane: świeżo utworzona tabela nie skompiluje się
 * w kodzie w ogóle, więc nie potrzebuje tej bramki, a jej `ALTER`-y dawałyby
 * tu wyłącznie szum.
 */
export function findStaleColumns(
  migrations: readonly ScannedMigration[],
  generated: GeneratedColumns,
): StaleColumn[] {
  const live = new Map<string, string>();
  for (const event of scanColumnEvents(migrations)) {
    switch (event.kind) {
      case "add":
        live.set(`${event.table}.${event.column}`, event.file);
        break;
      case "drop":
        live.delete(`${event.table}.${event.column}`);
        break;
      case "rename-column":
        // Nowa nazwa jest żywa BEZWARUNKOWO - patrz akapit o fałszywym spokoju
        // w nagłówku modułu. Prowenancją zostaje migracja przemianowania, bo to
        // ona wprowadziła kolumnę pod nazwą, której szuka kod.
        live.delete(`${event.table}.${event.from}`);
        live.set(`${event.table}.${event.to}`, event.file);
        break;
      case "rename-table":
        for (const [key, file] of [...live]) {
          const cut = key.indexOf(".");
          if (key.slice(0, cut) !== event.from) continue;
          live.delete(key);
          live.set(`${event.to}.${key.slice(cut + 1)}`, file);
        }
        break;
      case "drop-table":
        // Tabeli nie ma - nie ma też ŻADNEJ jej kolumny. Bez tej gałęzi wpisy
        // przeżywały własną tabelę i nie dawały się zbić żadną migracją.
        for (const key of [...live.keys()]) {
          if (key.slice(0, key.indexOf(".")) === event.table) live.delete(key);
        }
        break;
      default: {
        // Nagłówek `ColumnEvent` obiecywał, że dopisanie rodzaju bez gałęzi tutaj
        // przestaje się kompilować - `switch` bez tej asercji przepuszczał je po
        // cichu. Teraz obietnica jest pokryta: `never` nie przyjmie nowego wariantu.
        const unhandled: never = event;
        throw new Error(`nieobsłużone zdarzenie DDL: ${JSON.stringify(unhandled)}`);
      }
    }
  }
  const out: StaleColumn[] = [];
  for (const [key, file] of live) {
    const cut = key.indexOf(".");
    const table = key.slice(0, cut);
    const column = key.slice(cut + 1);
    const columns = generated.get(table);
    if (columns === undefined) continue;
    if (!columns.has(column)) out.push({ table, column, file });
  }
  return out.sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

/** `tabela.kolumna` - postać wpisu w zamrożonym długu. */
export function columnKey(entry: StaleColumn): string {
  return `${entry.table}.${entry.column}`;
}

export interface FreshnessReport {
  /** Nowy dług: kolumna dopisana migracją bez regeneracji typów. */
  readonly fresh: readonly StaleColumn[];
  /** Wpisy z baseline'u, które przestały być potrzebne - lista ma maleć. */
  readonly resolved: readonly string[];
  readonly total: number;
}

export function compareWithBaseline(
  stale: readonly StaleColumn[],
  baseline: readonly string[],
): FreshnessReport {
  const known = new Set(baseline);
  const seen = new Set(stale.map(columnKey));
  return {
    fresh: stale.filter((entry) => !known.has(columnKey(entry))),
    resolved: baseline.filter((key) => !seen.has(key)),
    total: stale.length,
  };
}

export function freshnessFailed(report: FreshnessReport): boolean {
  return report.fresh.length > 0 || report.resolved.length > 0;
}

export function renderFreshnessReport(report: FreshnessReport, baselineSize: number): string {
  if (!freshnessFailed(report)) {
    return `[types-freshness] OK - ${report.total} znanych kolumn poza wygenerowanymi typami (baseline: ${baselineSize}).`;
  }
  const lines: string[] = [];
  if (report.fresh.length > 0) {
    lines.push(
      `[types-freshness] ${report.fresh.length} NOWYCH kolumn dopisanych migracją bez regeneracji typów:`,
      ...report.fresh.map(
        (entry) => `  - ${entry.table}.${entry.column}  (dodana w ${entry.file})`,
      ),
      "",
      "Kod czytający taką kolumnę nie skompiluje się - i wtedy najtańszym wyjściem jest",
      "`as unknown as JakiśRow`, który od tej chwili ukrywa KAŻDY przyszły rozjazd",
      "z bazą. Dlatego to jest bramka, a nie ostrzeżenie.",
      "Napraw regeneracją typów:  supabase gen types typescript --linked > src/integrations/supabase/types.ts",
    );
  }
  if (report.resolved.length > 0) {
    lines.push(
      `[types-freshness] ${report.resolved.length} wpisów baseline'u jest już nieaktualnych - USUŃ je z listy:`,
      ...report.resolved.map((key) => `  - ${key}`),
      "",
      "Martwy wpis to przyszła furtka: nazwa zostaje, a wraz z nią zgoda na brak",
      "kolumny, o której nikt już nie pamięta.",
    );
  }
  return lines.join("\n");
}
