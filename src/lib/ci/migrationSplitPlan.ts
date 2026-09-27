// PLAN PODZIALU MIGRACJI - nazwy, wersje, dziennik drizzle, rejestr pasow.
// Warstwa czysta: dostaje tresci plikow i zwraca liste zapisow; dysk obsluguje
// `scripts/split-migration.ts` (przez `migrationSplitCli.ts`).
//
// NAZWY I WERSJE - DECYZJA.
//   * Czesc 1 ZOSTAJE POD NAZWA ORYGINALU (`<wersja>_<nazwa>.sql`, w drizzle
//     `<idx>_<nazwa>.sql`). Tej nazwy uzywaja juz: wpis `MIGRATION_LANES`
//     (blizniak czesci 1 nie zmienia sie ani o znak), `supabase/migration-ledger.json`
//     (`reconciled`), testy czytajace migracje po sufiksie nazwy i naglowek,
//     ktory opisuje cala zmiane. Zmiana nazwy czesci 1 przepisalaby te wszystkie
//     miejsca, a wersja w rejestrze Supabase zmienilaby znaczenie.
//   * Czesc k >= 2 dostaje `<wersja + k - 1>_<nazwa>_part<k>.sql`: wersje
//     rosna scisle o 1, wiec czesci ukladaja sie w sortowaniu po nazwie (tak
//     aplikuje je Supabase CLI i kazdy harness) BEZPOSREDNIO za czescia 1.
//     Wersja ostatniej czesci musi byc MNIEJSZA od nastepnej istniejacej
//     migracji - inaczej czesc wskoczylaby za cudza migracje albo zderzyla sie
//     z nia kluczem `schema_migrations.version`; wtedy plan konczy sie bledem.
//   * Pas drizzle, blizniak W DZIENNIKU: czesci 2..n dostaja KOLEJNE wolne
//     indeksy dziennika (`_journal.json`), `when` wieksze od kazdego
//     istniejacego (migrator drizzle pomija wpisy starsze od ostatnio
//     wykonanego) i snapshoty z lancuchem `prevId` od ostatniego snapshotu -
//     dokladnie tak, jak zapisuje je panel Lovable. Gdy za blizniakiem stoja
//     juz inne wpisy dziennika, czesci wykonalyby sie na pasie drizzle PO
//     nich - to jest blad, chyba ze autor jawnie potwierdzi `allowInterleave`.
//   * Pas drizzle, blizniak POZA DZIENNIKIEM (tak stoja blizniaki funkcji
//     organizatora, np. `0057_event_cfp`): czesci tez nie dostaja wpisow ani
//     snapshotow - wpis dla czesci 2..n kazalby migratorowi wykonac ogon
//     migracji, ktorej glowy nigdy nie wykonuje. Dostaja numer blizniaka
//     (`0057_event_cfp_part2`), wiec sortuja sie zaraz za nim i nie zajmuja
//     indeksu, ktory panel nada nastepnemu zapisowi wdrozenia.
//   * Zaden NOWY plik planu nie moze juz istniec (czesc, snapshot) - plan
//     konczy sie bledem zamiast nadpisac cudzy plik.
//
// HARNESSY DOBIERAJA MIGRACJE PO TRESCI (`grep -lE`). Czesc 3 migracji
// wydarzen, w ktorej akurat nie ma `FUNCTION public.event_...(`, wypadlaby
// z `scripts/events-harness/run.sh`, a czesc 4 wywrocilaby sie na brakujacej
// tabeli. Dlatego kazda czesc migracji wybranej przez harness ze znacznikiem
// (`events-harness: include`) niesie ten znacznik, znacznik `pg-harness:
// exclude` przechodzi z oryginalu na kazda czesc, a harness BEZ znacznika,
// z ktorego czesc by wypadla, konczy plan bledem. Wzorce sa kopia z plikow
// `run.sh` i test pilnuje, ze sie z nimi nie rozjechaly.
import {
  DEFAULT_MAX_BYTES,
  MigrationSplitError,
  splitAligned,
  utf8Length,
  type LaneSource,
} from "./migrationSplit";
import { DRIZZLE_DIR, SUPABASE_DIR } from "./migrationLaneParity";
import { parseMigrationFile, type MigrationFile } from "./migrationLedger";

export const SUPABASE_MIGRATIONS_DIR = SUPABASE_DIR;
export const DRIZZLE_MIGRATIONS_DIR = DRIZZLE_DIR;
export const DRIZZLE_JOURNAL = `${DRIZZLE_DIR}/meta/_journal.json`;
export const LANE_REGISTRY = "src/lib/ci/migrationLaneParity.ts";

/** Odstep `when` miedzy kolejnymi czesciami w dzienniku drizzle. */
export const WHEN_STEP_MS = 60_000;

/** Wiersz naglowka, po ktorym narzedzia rozpoznaja czesc podzielonej migracji. */
export const SPLIT_MARKER_RE = /^-- migration-split: part (\d+)\/(\d+) of (\S+)$/m;

/** Harness dobierajacy migracje po tresci albo nazwie pliku. */
export interface HarnessRule {
  readonly script: string;
  /** Wzorzec `grep -E` DOKLADNIE jak w skrypcie (test pilnuje zgodnosci). */
  readonly ere: string;
  /** Fragment nazwy, ktory skrypt dobiera globem (`ls *discussion_clubs*`). */
  readonly nameIncludes?: string;
  /** Znacznik, ktory `ere` przyjmuje - dopisywany kazdej czesci. */
  readonly marker?: string;
}

export const HARNESS_RULES: readonly HarnessRule[] = [
  {
    script: "scripts/events-harness/run.sh",
    ere: String.raw`public\.admin_event_|events_tenant_id_key|events-harness: include|FUNCTION public\.event_[a-z_]+\(`,
    marker: "events-harness: include",
  },
  {
    script: "scripts/pg-harness/run.sh",
    ere: String.raw`public\.(club_|admin_club_)`,
    nameIncludes: "discussion_clubs",
  },
  {
    script: "scripts/careers-harness/run.sh",
    ere: String.raw`public\.(career_|contact_messages)|'career-cv'`,
  },
  {
    script: "scripts/tenant-isolation-harness/run.sh",
    ere: String.raw`POLICY "(media_mentions owner|saved_searches owner|follows owner|purchases owner read|subs owner read|grants own read|seats own read|gift links owner read|Users can view own subscription|read_history owner|personality_history_owner_read)|pages_parent_same_tenant_fkey`,
  },
];

/** Znaczniki przenoszone z oryginalu na kazda czesc (wykluczenie z harnessu). */
export const PROPAGATED_MARKERS: readonly string[] = ["pg-harness: exclude"];

export function harnessSelects(rule: HarnessRule, file: string, sql: string): boolean {
  return (
    new RegExp(rule.ere).test(sql) ||
    (rule.nameIncludes !== undefined && file.includes(rule.nameIncludes))
  );
}

export interface JournalEntry {
  readonly idx: number;
  readonly version: string;
  readonly when: number;
  readonly tag: string;
  readonly breakpoints: boolean;
}

export interface DrizzleJournal {
  readonly version: string;
  readonly dialect: string;
  readonly entries: readonly JournalEntry[];
}

export type DrizzleSnapshot = { readonly id: string; readonly prevId: string } & Readonly<
  Record<string, unknown>
>;

/** Wersja czesci: wersja oryginalu + przesuniecie, 14 cyfr jak w nazwie pliku. */
export function partVersion(version: string, offset: number): string {
  return (BigInt(version) + BigInt(offset)).toString().padStart(14, "0");
}

export function supabasePartName(version: string, label: string, k: number): string {
  return k === 1
    ? `${version}_${label}.sql`
    : `${partVersion(version, k - 1)}_${label}_part${k}.sql`;
}

/**
 * Tag czesci k pasa drizzle: czesc 1 to blizniak bez zmian, czesc k >= 2 -
 * sufiks `_part<k>` i numer: kolejny wolny indeks dziennika za `maxIdx`, gdy
 * blizniak jest w dzienniku, albo numer blizniaka (`maxIdx === null`), gdy
 * go tam nie ma.
 */
export function drizzlePartTag(tag: string, maxIdx: number | null, k: number): string {
  if (k === 1) return tag;
  const [, prefix, label] = /^(\d+)_(.+)$/.exec(tag)!;
  const index = maxIdx === null ? prefix : String(maxIdx + k - 1).padStart(4, "0");
  return `${index}_${label}_part${k}`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Czesci 2..n migracji `file` wsrod `files`, w kolejnosci czesci - rozpoznane
 * po nazwie `<liczba>_<nazwa>_part<k>.sql` I po naglowku `migration-split`
 * wskazujacym `file` (sama nazwa nie wystarcza: `..._gaps_part3.sql` to nazwa
 * zwyklej migracji, nie czesc 3).
 */
export function continuationParts(
  file: string,
  files: readonly string[],
  read: (name: string) => string | null,
): string[] {
  const label = file.replace(/^\d+_/, "").replace(/\.sql$/, "");
  const shape = new RegExp(`^\\d+_${escapeRegExp(label)}_part(\\d+)\\.sql$`);
  return files
    .map((name) => ({ name, shape: shape.exec(name) }))
    .filter((c) => c.shape !== null)
    .map((c) => ({ name: c.name, marker: SPLIT_MARKER_RE.exec(read(c.name) ?? "") }))
    .filter((c) => c.marker !== null && c.marker[3] === file)
    .sort((a, b) => Number(a.marker![1]) - Number(b.marker![1]))
    .map((c) => c.name);
}

interface HeaderContext {
  readonly original: string;
  readonly partName: (k: number) => string;
  readonly markers: readonly string[];
  readonly maxBytes: number;
}

/** Naglowek czesci k >= 2 - czysty komentarz ASCII w stylu naglowkow repo. */
export function partHeader(ctx: HeaderContext, k: number, n: number): string {
  return [
    `-- CZESC ${k}/${n} MIGRACJI ${ctx.original}`,
    `-- migration-split: part ${k}/${n} of ${ctx.original}`,
    "--",
    "-- PO CO PODZIAL. Panel Lovable nie wdraza duzych plikow migracji (wdrozyl",
    "-- 52 653 B, odrzucil pliki od 62 KB wzwyz), wiec scripts/split-migration.ts",
    `-- pocial oryginal na czesci po najwyzej ${ctx.maxBytes} B - wylacznie na granicach`,
    "-- instrukcji najwyzszego poziomu i bez oddzielania obiektu od jego RLS",
    `-- i REVOKE. Czesci wdraza sie PO KOLEI: ${ctx.partName(1)},`,
    `-- potem ${ctx.partName(2)} .. ${ctx.partName(n)}.`,
    "-- SQL wykonywalny czesci sklejonych w tej kolejnosci == SQL oryginalu",
    "-- (dowod: src/lib/ci/migrationSplit.ts). Opis zmian i uzasadnienie - w czesci 1.",
    ...ctx.markers.map((m) => `-- ${m}`),
    "",
  ].join("\n");
}

/** Stopka czesci 1 - dokad idzie ciag dalszy. */
export function partTrailer(ctx: HeaderContext, n: number): string {
  return [
    "",
    `-- migration-split: part 1/${n} of ${ctx.original}`,
    `-- CIAG DALSZY: ${ctx.partName(2)} .. ${ctx.partName(n)}`,
    "-- (scripts/split-migration.ts, limit wdrozenia Lovable). SQL wykonywalny",
    `-- czesci 1..${n} sklejonych po kolei == SQL tej migracji sprzed podzialu.`,
    ...ctx.markers.map((m) => `-- ${m}`),
    "",
  ].join("\n");
}

/**
 * Dopisuje do rejestru `MIGRATION_LANES` wpisy czesci ZARAZ za wpisem
 * oryginalu. Mechanicznie, wiec tylko wtedy, gdy wpis oryginalu ma dokladnie
 * ksztalt `{ tag, twin }` i wystepuje raz; inaczej `null` (wpisy do reki).
 */
export function insertLaneEntries(
  source: string,
  tag: string,
  twin: string,
  entries: readonly { readonly tag: string; readonly twin: string }[],
): string | null {
  const block = `\n  {\n    tag: "${tag}",\n    twin: "${twin}",\n  },\n`;
  const at = source.indexOf(block);
  if (at === -1 || source.indexOf(block, at + 1) !== -1) return null;
  const added = [
    `  // Czesci 2..${entries.length + 1} migracji ${tag} (scripts/split-migration.ts,`,
    "  // limit wdrozenia Lovable) - kazda para czesci to pelne blizniaki.",
    ...entries.map((e) => `  {\n    tag: "${e.tag}",\n    twin: "${e.twin}",\n  },`),
  ].join("\n");
  const end = at + block.length;
  return `${source.slice(0, end)}${added}\n${source.slice(end)}`;
}

export interface DrizzleTwinInput {
  /** Tag blizniaka (nazwa pliku bez `.sql`), np. `0067_event_registration_gaps_part3`. */
  readonly tag: string;
  readonly sql: string;
  readonly journal: DrizzleJournal;
  /**
   * Snapshot OSTATNIEGO wpisu dziennika - poprzednik w lancuchu `prevId`.
   * Potrzebny tylko, gdy blizniak jest w dzienniku (`undefined` = brak pliku).
   */
  readonly lastSnapshot?: DrizzleSnapshot;
}

export interface SplitPlanInput {
  /** Nazwa pliku w `supabase/migrations/`, np. `20260926180000_x.sql`. */
  readonly supabaseFile: string;
  readonly supabaseSql: string;
  /** Wszystkie nazwy plikow `supabase/migrations/*.sql` (z dzielonym wlacznie). */
  readonly supabaseFiles: readonly string[];
  readonly drizzle?: DrizzleTwinInput;
  readonly maxBytes?: number;
  /** Generator identyfikatorow snapshotow (w CLI `crypto.randomUUID`). */
  readonly newId: () => string;
  /** Tresc `src/lib/ci/migrationLaneParity.ts` - do mechanicznej edycji rejestru. */
  readonly registrySource?: string;
  /** Pliki, ktore moga czytac migracje PO NAZWIE (testy, skrypty harnessow). */
  readonly references?: readonly { readonly path: string; readonly content: string }[];
  /** Zgoda na czesci drizzle za wpisami dziennika, ktore juz stoja za blizniakiem. */
  readonly allowInterleave?: boolean;
  /** Istniejace pliki obu pasow (sciezki wzgledem repo) - nowy plik planu nie moze byc wsrod nich. */
  readonly existingPaths?: readonly string[];
}

export interface FileWrite {
  readonly path: string;
  readonly content: string;
}

export interface SplitPlan {
  readonly parts: number;
  readonly supabaseParts: readonly string[];
  readonly drizzleParts: readonly string[];
  /** Zapisy do wykonania (sciezki wzgledem katalogu repozytorium). */
  readonly writes: readonly FileWrite[];
  /** Wpisy `MIGRATION_LANES` dla czesci 2..n (puste bez blizniaka drizzle). */
  readonly laneEntries: readonly { readonly tag: string; readonly twin: string }[];
  readonly registryEdited: boolean;
  readonly warnings: readonly string[];
  /** Rozmiar kazdej czesci (UTF-8) - do raportu CLI. */
  readonly sizes: readonly { readonly path: string; readonly bytes: number }[];
}

function fail(message: string): never {
  throw new MigrationSplitError(message);
}

function referenceWarnings(input: SplitPlanInput, label: string): string[] {
  const needles = [input.supabaseFile, `_${label}.sql`];
  if (input.drizzle) needles.push(`${input.drizzle.tag}.sql`);
  return (input.references ?? [])
    .filter((ref) => needles.some((needle) => ref.content.includes(needle)))
    .map(
      (ref) =>
        `${ref.path} wskazuje te migracje po nazwie - po podziale plik ma tylko czesc 1; czytaj calosc przez readLogicalMigration() z src/lib/ci/migrationSize.ts albo wskaz wlasciwa czesc.`,
    );
}

/** Plan podzialu migracji i jej blizniaka drizzle - bez dotykania dysku. */
export function planMigrationSplit(input: SplitPlanInput): SplitPlan {
  const parsed = parseMigrationFile(input.supabaseFile);
  if (!parsed) fail(`${input.supabaseFile}: nazwa spoza konwencji <14 cyfr>_<nazwa>.sql.`);
  const { version, label } = parsed;
  // Czesc 1 po podziale niesie stopke `part 1/n`, czesc k - naglowek `part k/n`.
  if (SPLIT_MARKER_RE.test(input.supabaseSql)) {
    fail(`${input.supabaseFile} jest juz czescia podzielonej migracji - nie tniemy drugi raz.`);
  }

  const others = input.supabaseFiles
    .filter((f) => f !== input.supabaseFile)
    .map((f) => parseMigrationFile(f))
    .filter((p): p is MigrationFile => p !== null);
  const sameVersion = others.filter((p) => p.version === version).map((p) => p.file);
  if (sameVersion.length > 0) {
    fail(
      `Wersje ${version} maja tez: ${sameVersion.join(", ")}. Najpierw nadaj unikalne wersje - kolejnosc czesci wzgledem tych plikow bylaby przypadkowa.`,
    );
  }
  const next = others
    .map((p) => BigInt(p.version))
    .filter((v) => v > BigInt(version))
    .reduce<bigint | undefined>((min, v) => (min === undefined || v < min ? v : min), undefined);

  const drizzle = input.drizzle;
  if (drizzle && !/^\d+_.+$/.test(drizzle.tag)) {
    fail(`${drizzle.tag}: tag drizzle spoza konwencji <numer>_<nazwa>.`);
  }
  const twinEntry = drizzle?.journal.entries.find((e) => e.tag === drizzle.tag);
  const entries = drizzle?.journal.entries ?? [];
  const maxIdx = Math.max(0, ...entries.map((e) => e.idx));
  const maxWhen = Math.max(0, ...entries.map((e) => e.when));
  // Numer czesci drizzle: z dziennika, gdy blizniak w nim jest; inaczej numer blizniaka.
  const partIdxBase = twinEntry === undefined ? null : maxIdx;

  const matched = HARNESS_RULES.filter((rule) =>
    harnessSelects(rule, input.supabaseFile, input.supabaseSql),
  );
  const markers = [
    ...new Set([
      ...matched.flatMap((rule) => (rule.marker === undefined ? [] : [rule.marker])),
      ...PROPAGATED_MARKERS.filter((m) => input.supabaseSql.includes(m)),
    ]),
  ];
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const lane = (sql: string, ctx: HeaderContext): LaneSource => ({
    sql,
    header: (k, n) => partHeader(ctx, k, n),
    trailer: (n) => partTrailer(ctx, n),
  });
  const lanes = [
    lane(input.supabaseSql, {
      original: input.supabaseFile,
      partName: (k) => supabasePartName(version, label, k),
      markers,
      maxBytes,
    }),
  ];
  if (drizzle) {
    lanes.push(
      lane(drizzle.sql, {
        original: `${drizzle.tag}.sql`,
        partName: (k) => `${drizzlePartTag(drizzle.tag, partIdxBase, k)}.sql`,
        markers: [],
        maxBytes,
      }),
    );
  }
  const result = splitAligned(lanes, { maxBytes });
  const n = result.lanes[0]!.length;

  if (n === 1) {
    return {
      parts: 1,
      supabaseParts: [input.supabaseFile],
      drizzleParts: drizzle ? [drizzle.tag] : [],
      writes: [],
      laneEntries: [],
      registryEdited: false,
      warnings: [
        `${input.supabaseFile} miesci sie w limicie ${maxBytes} B - nie ma czego dzielic.`,
      ],
      sizes: [],
    };
  }

  const lastVersion = BigInt(partVersion(version, n - 1));
  if (next !== undefined && next <= lastVersion) {
    fail(
      `Czesci potrzebuja wersji ${partVersion(version, 1)}..${lastVersion}, a nastepna migracja ma wersje ${next}. Przenumeruj ${input.supabaseFile} albo sasiada tak, zeby zostalo ${n - 1} wolnych wersji.`,
    );
  }

  const warnings: string[] = [];
  if (drizzle && twinEntry) {
    const after = entries.filter((e) => e.idx > twinEntry.idx).map((e) => e.tag);
    if (after.length > 0) {
      const note = `W dzienniku drizzle za ${drizzle.tag} stoja juz: ${after.join(", ")}. Czesci 2..${n} dostana indeksy za nimi, wiec na pasie drizzle wykonaja sie PO nich.`;
      if (!input.allowInterleave) {
        fail(
          `${note} Podziel plik, zanim dopiszesz kolejne migracje (albo przenumeruj je za czesci), albo potwierdz --allow-interleave, gdy nie zaleza od obiektow z czesci 2..${n}.`,
        );
      }
      warnings.push(`${note} Potwierdzone --allow-interleave.`);
    }
    if (drizzle.lastSnapshot === undefined) {
      fail(
        `Brak ${DRIZZLE_MIGRATIONS_DIR}/meta/${String(maxIdx).padStart(4, "0")}_snapshot.json - lancuch prevId snapshotow czesci nie ma od czego wyjsc.`,
      );
    }
  }

  const supabaseParts = result.lanes[0]!.map((_, k) => supabasePartName(version, label, k + 1));
  supabaseParts.forEach((name, k) => {
    const text = result.lanes[0]![k]!.text;
    for (const rule of HARNESS_RULES) {
      const selected = harnessSelects(rule, name, text);
      if (matched.includes(rule) && !selected) {
        fail(
          `${name} wypadlaby z ${rule.script} (oryginal jest w jego zestawie, a ten harness nie ma znacznika wlaczenia). Dopisz do harnessu znacznik albo podziel migracje recznie.`,
        );
      }
      if (!matched.includes(rule) && selected) {
        fail(`${name} weszlaby do ${rule.script}, choc oryginalu w nim nie ma.`);
      }
    }
  });

  const writes: FileWrite[] = supabaseParts.map((name, k) => ({
    path: `${SUPABASE_MIGRATIONS_DIR}/${name}`,
    content: result.lanes[0]![k]!.text,
  }));
  const overwrites = new Set([writes[0]!.path, DRIZZLE_JOURNAL, LANE_REGISTRY]);
  const laneEntries: { tag: string; twin: string }[] = [];
  const drizzleParts: string[] = [];
  let registryEdited = false;

  if (drizzle) {
    const journalEntries = [...entries];
    let prevId = drizzle.lastSnapshot?.id;
    result.lanes[1]!.forEach((part, k) => {
      const tag = drizzlePartTag(drizzle.tag, partIdxBase, k + 1);
      drizzleParts.push(tag);
      writes.push({ path: `${DRIZZLE_MIGRATIONS_DIR}/${tag}.sql`, content: part.text });
      if (k === 0) return;
      laneEntries.push({ tag, twin: supabaseParts[k]! });
      if (twinEntry === undefined) return;
      journalEntries.push({
        idx: maxIdx + k,
        version: twinEntry.version,
        when: maxWhen + k * WHEN_STEP_MS,
        tag,
        breakpoints: twinEntry.breakpoints,
      });
      const id = input.newId();
      writes.push({
        path: `${DRIZZLE_MIGRATIONS_DIR}/meta/${String(maxIdx + k).padStart(4, "0")}_snapshot.json`,
        content: `${JSON.stringify({ ...drizzle.lastSnapshot, id, prevId }, null, 2)}\n`,
      });
      prevId = id;
    });
    overwrites.add(`${DRIZZLE_MIGRATIONS_DIR}/${drizzle.tag}.sql`);
    if (twinEntry === undefined) {
      warnings.push(
        `${drizzle.tag} nie ma wpisu w ${DRIZZLE_JOURNAL}, wiec czesci drizzle tez go nie dostaja (bez wpisow i snapshotow; numer blizniaka). Zapis wdrozenia panel Lovable dopisze sam, jak dla kazdej migracji.`,
      );
    } else {
      writes.push({
        path: DRIZZLE_JOURNAL,
        content: `${JSON.stringify({ ...drizzle.journal, entries: journalEntries }, null, 2)}\n`,
      });
    }
    const edited =
      input.registrySource === undefined
        ? null
        : insertLaneEntries(input.registrySource, drizzle.tag, input.supabaseFile, laneEntries);
    if (edited === null) {
      warnings.push(
        `Rejestr ${LANE_REGISTRY} NIE zostal zmieniony (wpis ${drizzle.tag} nie ma prostego ksztaltu { tag, twin }) - dopisz wpisy czesci recznie, zaraz za nim.`,
      );
    } else {
      writes.push({ path: LANE_REGISTRY, content: edited });
      registryEdited = true;
    }
  } else {
    warnings.push(
      `${input.supabaseFile} nie ma blizniaka drizzle w MIGRATION_LANES - dzielony jest tylko pas supabase.`,
    );
  }

  const existing = new Set(input.existingPaths ?? []);
  const clash = writes.map((w) => w.path).filter((p) => !overwrites.has(p) && existing.has(p));
  if (clash.length > 0) {
    fail(
      `Plan nadpisalby istniejace pliki: ${clash.join(", ")}. Usun je albo przenumeruj, jesli to pozostalosc poprzedniego podzialu; cudzego pliku nie nadpisujemy.`,
    );
  }

  return {
    parts: n,
    supabaseParts,
    drizzleParts,
    writes,
    laneEntries,
    registryEdited,
    warnings: [...warnings, ...referenceWarnings(input, label)],
    sizes: writes
      .filter((w) => w.path.endsWith(".sql"))
      .map((w) => ({ path: w.path, bytes: utf8Length(w.content) })),
  };
}
