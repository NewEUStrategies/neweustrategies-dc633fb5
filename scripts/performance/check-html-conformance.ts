/**
 * Raport ZGODNOŚCI HTML dokumentów SSR (Nu Html Checker, vnu) - TRYB RAPORTU.
 *
 * Waliduje dokument serwera - zapisany plik (`--html`) albo dokument
 * wyrenderowany z artefaktu `build:smoke` z backendem fixture (`--root` +
 * `--path`, dokładnie jak `sampleArtifact` w `check-document-weight.ts`) -
 * programem vnu w wersji z raportu produkcyjnego (`vnu-jar@26.11.17`,
 * `--format json --also-check-css`) i klasyfikuje każdy komunikat według
 * `scripts/performance/html-conformance-allowlist.json`:
 *   - `accepted`  - świadome odstępstwa i fałszywe alarmy silnika CSS vnu,
 *   - `knownDebt` - dług znany (inline `<style>` w `<body>`, sekcje bez
 *     nagłówka): NIE zaakceptowany, tylko oczekiwany do refaktoru,
 *   - NOWE        - wszystko, czego nie dopasował żaden wpis.
 * Wypisuje tabelę per dokument (razem / akcept. / dług / NOWE według rodzaju:
 * error, warning, info), dopasowania wpisów listy i NOWE komunikaty z pozycją
 * i wycinkiem; `--json` zapisuje pełny sklasyfikowany raport.
 *
 * DLACZEGO TRYB RAPORTU (kod 0 domyślnie). Dokumenty bazy mają kilkanaście
 * NOWYCH błędów (dane fixture w CSS, ARIA, format `<time>`), których naprawa
 * to osobne pakiety; bramka czerwona od pierwszego dnia blokowałaby wydania,
 * nie dając żadnej nowej informacji. `--strict` (kod 1 przy NOWYM błędzie)
 * służy kontroli lokalnej i późniejszemu włączeniu w CI, gdy NOWE zejdą do
 * zera. Skrypt NIE jest podpięty pod żaden workflow. Błąd konfiguracji (brak
 * Javy, vnu, nieprawidłowa lista) kończy się kodem 1 zawsze.
 *
 * vnu: `VNU_JAR` (ścieżka do vnu.jar) albo jednorazowe pobranie przypiętego
 * tarballa npm `vnu-jar@26.11.17` (`npm pack`, suma sha512 sprawdzana przed
 * rozpakowaniem) do `node_modules/.cache/vnu-jar/26.11.17/` - bez zależności
 * w package.json/bun.lock. Wymaga Javy (`java` w PATH albo `JAVA_HOME`).
 *
 * Usage:
 *   bun run scripts/performance/check-html-conformance.ts --html dokument.html [--html inny.html]
 *   bun run scripts/performance/check-html-conformance.ts [--root .] [--path /] [--path /blog]
 *   opcje wspólne: [--json reports/html-conformance.json] [--strict] [--allowlist lista.json]
 *
 * Tryb `--root` wymaga zbudowanego artefaktu: BUNDLE_INVENTORY=1 bun run build:smoke.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Wersja vnu z raportu produkcyjnego; zmiana wymaga przejrzenia wzorców listy. */
export const VNU_VERSION = "26.11.17";
/** `dist.integrity` tarballa `vnu-jar@26.11.17` z rejestru npm (sprawdzane po `npm pack`). */
export const VNU_TARBALL_INTEGRITY =
  "sha512-3JvzyhnKUvpwD/uV8d3wUS7UY5BDxJwZ88i4SqLqBoYpBLuL19TkfcfCo+3VDABoGM47c80YKdbJfaI90qcthg==";
export const DEFAULT_ALLOWLIST = join(
  REPO_ROOT,
  "scripts/performance/html-conformance-allowlist.json",
);
/** Ten sam przypadek fixture co bramka wagi: te same dokumenty `/`, `/blog`, wpis. */
const MEASUREMENT_CASE = "document-weight";
/** Ile wystąpień jednego NOWEGO komunikatu wypisać; komplet jest w `--json`. */
const MAX_EXAMPLES = 5;
const EXTRACT_MAX_CHARS = 180;

export type MessageKind = "error" | "warning" | "info";
export type Verdict = "accepted" | "knownDebt" | "new";
export type AllowlistGroup = Exclude<Verdict, "new">;

export const KINDS: readonly MessageKind[] = ["error", "warning", "info"];
const GROUPS: readonly AllowlistGroup[] = ["accepted", "knownDebt"];

/** Komunikat vnu (`--format json`); pola zgodne z https://github.com/validator/validator/wiki/Output-»-JSON */
export interface VnuMessage {
  readonly type: string;
  readonly subType?: string;
  readonly message?: string;
  readonly extract?: string;
  readonly url?: string;
  readonly firstLine?: number;
  readonly lastLine?: number;
  readonly firstColumn?: number;
  readonly lastColumn?: number;
  readonly hiliteStart?: number;
  readonly hiliteLength?: number;
}

export interface VnuOutput {
  /** Np. `26.11.17 (a4bee0f)`; `null`, gdy vnu nie podał wersji. */
  readonly version: string | null;
  readonly messages: readonly VnuMessage[];
}

export interface AllowlistEntry {
  readonly id: string;
  readonly type?: MessageKind;
  readonly message: string;
  readonly extract?: string;
  readonly reason: string;
  readonly source?: string;
}

export interface CompiledEntry {
  readonly id: string;
  readonly group: AllowlistGroup;
  readonly type: MessageKind | null;
  readonly message: RegExp;
  readonly extract: RegExp | null;
}

export interface ClassifiedMessage {
  readonly kind: MessageKind;
  readonly verdict: Verdict;
  readonly entryId: string | null;
  readonly message: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly extract: string;
  readonly hiliteStart: number | null;
  readonly hiliteLength: number | null;
}

export type VerdictCounts = Record<Verdict | "total", number>;
export type DocumentSummary = Record<MessageKind | "all", VerdictCounts>;

/** Błąd konfiguracji z gotowym komunikatem dla człowieka (bez stosu). */
export class ConformanceSetupError extends Error {}

/**
 * JSON vnu z wyjścia procesu. JVM poprzedza go linią `Picked up
 * JAVA_TOOL_OPTIONS: ...` na stderr, więc parsujemy od pierwszej linii
 * zaczynającej się od `{` (zapasowo: od pierwszego `{`) do ostatniego `}`.
 */
export function parseVnuOutput(text: string): VnuOutput {
  const lineStart = text.search(/^\{/m);
  const start = lineStart >= 0 ? lineStart : text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new ConformanceSetupError(
      `vnu nie zwrócił raportu JSON. Początek wyjścia: ${text.slice(0, 400) || "(puste)"}`,
    );
  }
  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    version?: unknown;
    messages?: unknown;
  };
  if (!Array.isArray(parsed.messages)) {
    throw new ConformanceSetupError("Raport vnu bez tablicy `messages` - nieznany format wyjścia.");
  }
  return {
    version: typeof parsed.version === "string" ? parsed.version : null,
    messages: parsed.messages as VnuMessage[],
  };
}

/** `error`, `warning` (vnu: `info` + `subType: warning`) albo `info`; nieznany typ liczy się jak błąd. */
export function messageKind(message: Pick<VnuMessage, "type" | "subType">): MessageKind {
  if (message.type === "info") return message.subType === "warning" ? "warning" : "info";
  return "error";
}

function compileRegExp(pattern: unknown, where: string): RegExp {
  if (typeof pattern !== "string" || !pattern) {
    throw new ConformanceSetupError(`${where}: wzorzec musi być niepustym napisem.`);
  }
  try {
    return new RegExp(pattern, "u");
  } catch (error) {
    throw new ConformanceSetupError(
      `${where}: nieprawidłowe wyrażenie regularne (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

/**
 * Waliduje i kompiluje listę (`accepted` przed `knownDebt` - kolejność
 * dopasowania). Wpis bez `id`, z powtórzonym `id`, bez uzasadnienia (`reason`),
 * z nieznanym `type` albo złym wzorcem przerywa przebieg: lista bez
 * udokumentowanych wpisów nie może po cichu ukrywać komunikatów.
 */
export function compileAllowlist(raw: unknown): CompiledEntry[] {
  if (!raw || typeof raw !== "object") {
    throw new ConformanceSetupError("Lista klasyfikacji musi być obiektem JSON.");
  }
  const file = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const compiled: CompiledEntry[] = [];
  for (const group of GROUPS) {
    const entries = file[group];
    if (!Array.isArray(entries)) {
      throw new ConformanceSetupError(`Lista klasyfikacji: brak tablicy \`${group}\`.`);
    }
    entries.forEach((value: unknown, index) => {
      const entry = (value ?? {}) as Partial<Record<keyof AllowlistEntry, unknown>>;
      const where = `${group}[${index}]`;
      if (typeof entry.id !== "string" || !entry.id.trim()) {
        throw new ConformanceSetupError(`${where}: brak \`id\`.`);
      }
      const id = entry.id;
      if (seen.has(id)) throw new ConformanceSetupError(`${where}: powtórzone \`id\` "${id}".`);
      seen.add(id);
      if (typeof entry.reason !== "string" || !entry.reason.trim()) {
        throw new ConformanceSetupError(`${where} (${id}): brak uzasadnienia \`reason\`.`);
      }
      if (entry.type !== undefined && !KINDS.includes(entry.type as MessageKind)) {
        throw new ConformanceSetupError(
          `${where} (${id}): \`type\` musi być jednym z ${KINDS.join(", ")}.`,
        );
      }
      compiled.push({
        id,
        group,
        type: (entry.type as MessageKind | undefined) ?? null,
        message: compileRegExp(entry.message, `${where} (${id}).message`),
        extract:
          entry.extract === undefined
            ? null
            : compileRegExp(entry.extract, `${where} (${id}).extract`),
      });
    });
  }
  return compiled;
}

export function loadAllowlist(file: string): CompiledEntry[] {
  if (!existsSync(file)) {
    throw new ConformanceSetupError(`Brak listy klasyfikacji ${file}.`);
  }
  return compileAllowlist(JSON.parse(readFileSync(file, "utf8")) as unknown);
}

/** Pierwszy pasujący wpis (rodzaj, treść, opcjonalnie wycinek) albo NOWE. */
export function classifyMessage(
  message: VnuMessage,
  entries: readonly CompiledEntry[],
): ClassifiedMessage {
  const kind = messageKind(message);
  const text = message.message ?? "";
  const extract = message.extract ?? "";
  const entry = entries.find(
    (e) =>
      (e.type === null || e.type === kind) &&
      e.message.test(text) &&
      (e.extract === null || e.extract.test(extract)),
  );
  return {
    kind,
    verdict: entry?.group ?? "new",
    entryId: entry?.id ?? null,
    message: text,
    line: message.firstLine ?? message.lastLine ?? null,
    column: message.firstColumn ?? message.lastColumn ?? null,
    extract,
    hiliteStart: message.hiliteStart ?? null,
    hiliteLength: message.hiliteLength ?? null,
  };
}

export function classifyMessages(
  messages: readonly VnuMessage[],
  entries: readonly CompiledEntry[],
): ClassifiedMessage[] {
  return messages.map((m) => classifyMessage(m, entries));
}

const emptyCounts = (): VerdictCounts => ({ total: 0, accepted: 0, knownDebt: 0, new: 0 });

export function summarize(messages: readonly ClassifiedMessage[]): DocumentSummary {
  const summary: DocumentSummary = {
    error: emptyCounts(),
    warning: emptyCounts(),
    info: emptyCounts(),
    all: emptyCounts(),
  };
  for (const m of messages) {
    for (const row of [summary[m.kind], summary.all]) {
      row.total += 1;
      row[m.verdict] += 1;
    }
  }
  return summary;
}

/** `--strict`: wyłącznie NOWY błąd (nie ostrzeżenie, nie info) kończy przebieg kodem 1. */
export function countNewErrors(messages: readonly ClassifiedMessage[]): number {
  return messages.filter((m) => m.kind === "error" && m.verdict === "new").length;
}

/** Wycinek w jednej linii, z miejscem komunikatu w »«, przycięty wokół niego. */
export function formatExtract(m: ClassifiedMessage): string {
  let text = m.extract;
  if (m.hiliteStart !== null && m.hiliteLength !== null && m.hiliteStart <= text.length) {
    const end = m.hiliteStart + m.hiliteLength;
    text = `${text.slice(0, m.hiliteStart)}»${text.slice(m.hiliteStart, end)}«${text.slice(end)}`;
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= EXTRACT_MAX_CHARS) return text;
  const mark = Math.max(0, text.indexOf("»"));
  const from = Math.max(0, Math.min(mark - 40, text.length - EXTRACT_MAX_CHARS));
  const cut = text.slice(from, from + EXTRACT_MAX_CHARS);
  return `${from > 0 ? "…" : ""}${cut}${from + EXTRACT_MAX_CHARS < text.length ? "…" : ""}`;
}

// --- vnu i Java -------------------------------------------------------------

function javaBinary(): string {
  const home = process.env.JAVA_HOME?.trim();
  if (home) {
    const bin = join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (existsSync(bin)) return bin;
  }
  return "java";
}

function assertJava(java: string): void {
  const probe = spawnSync(java, ["-version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    const why = probe.error ? probe.error.message : `kod ${probe.status}`;
    throw new ConformanceSetupError(
      `Brak działającej Javy (\`${java} -version\`: ${why}). vnu.jar to program JVM - ` +
        "zainstaluj JRE (np. `apt-get install openjdk-21-jre-headless`, `brew install openjdk`) " +
        "albo wskaż ją przez JAVA_HOME.",
    );
  }
}

export function vnuCacheDir(root = REPO_ROOT): string {
  return join(root, "node_modules/.cache/vnu-jar", VNU_VERSION);
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) {
    const why =
      result.error?.message ?? `kod ${result.status}: ${result.stderr.trim().slice(-800)}`;
    throw new ConformanceSetupError(`\`${command} ${args.join(" ")}\` nie powiodło się (${why}).`);
  }
  return result.stdout;
}

/**
 * Jednorazowe pobranie przypiętego `vnu-jar` z rejestru npm: `npm pack` do
 * katalogu roboczego obok cache (ten sam system plików - `rename` jest
 * atomowy), sprawdzenie sumy sha512 tarballa, rozpakowanie WYŁĄCZNIE
 * `package/build/dist/vnu.jar`. Przerwane pobranie nie zostawia
 * połowicznego cache: katalog wersji powstaje dopiero po weryfikacji.
 */
function downloadVnuJar(dir: string): void {
  const parent = dirname(dir);
  mkdirSync(parent, { recursive: true });
  const staging = mkdtempSync(join(parent, `.pobieranie-${VNU_VERSION}-`));
  try {
    console.log(`vnu: pobieram vnu-jar@${VNU_VERSION} z rejestru npm (jednorazowo) do ${dir}`);
    run(
      "npm",
      ["pack", `vnu-jar@${VNU_VERSION}`, "--pack-destination", staging, "--ignore-scripts"],
      REPO_ROOT,
    );
    const tarball = readdirSync(staging).find((f) => f.endsWith(".tgz"));
    if (!tarball) throw new ConformanceSetupError("`npm pack` nie zostawił tarballa vnu-jar.");
    const tarballPath = join(staging, tarball);
    const integrity = `sha512-${createHash("sha512").update(readFileSync(tarballPath)).digest("base64")}`;
    if (integrity !== VNU_TARBALL_INTEGRITY) {
      throw new ConformanceSetupError(
        `Suma tarballa vnu-jar@${VNU_VERSION} się nie zgadza (${integrity}, oczekiwana ${VNU_TARBALL_INTEGRITY}).`,
      );
    }
    const out = join(staging, "vnu");
    mkdirSync(out);
    run(
      "tar",
      ["-xzf", tarballPath, "-C", out, "--strip-components=3", "package/build/dist/vnu.jar"],
      REPO_ROOT,
    );
    if (!existsSync(join(out, "vnu.jar"))) {
      throw new ConformanceSetupError(`Tarball vnu-jar@${VNU_VERSION} bez build/dist/vnu.jar.`);
    }
    try {
      renameSync(out, dir);
    } catch (error) {
      // Równoległy przebieg zdążył pierwszy - jego cache jest kompletny.
      if (!existsSync(join(dir, "vnu.jar"))) throw error;
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** `VNU_JAR`, inaczej cache przypiętej wersji (pobierany przy pierwszym użyciu). */
export function resolveVnuJar(): string {
  const fromEnv = process.env.VNU_JAR?.trim();
  if (fromEnv) {
    const jar = resolve(fromEnv);
    if (!existsSync(jar))
      throw new ConformanceSetupError(`VNU_JAR=${fromEnv} - plik nie istnieje.`);
    return jar;
  }
  const dir = vnuCacheDir();
  const jar = join(dir, "vnu.jar");
  if (!existsSync(jar)) downloadVnuJar(dir);
  return jar;
}

/** vnu na kopii dokumentu w pliku tymczasowym (bajty bez zmian, rozszerzenie `.html`). */
function runVnu(java: string, jar: string, html: Buffer): VnuOutput {
  const dir = mkdtempSync(join(tmpdir(), "nes-vnu-"));
  try {
    const file = join(dir, "document.html");
    writeFileSync(file, html);
    const result = spawnSync(
      java,
      ["-jar", jar, "--format", "json", "--also-check-css", "--exit-zero-always", "--stdout", file],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new ConformanceSetupError(
        `vnu zakończył się kodem ${result.status}: ${result.stderr.trim().slice(-800)}`,
      );
    }
    const output = parseVnuOutput(result.stdout.includes("{") ? result.stdout : result.stderr);
    // `non-document-error` = vnu nie przeczytał pliku (I/O, kodowanie) - to nie wynik walidacji.
    const fatal = output.messages.find((m) => m.type === "non-document-error");
    if (fatal) {
      throw new ConformanceSetupError(
        `vnu nie sprawdził dokumentu: ${fatal.message ?? fatal.type}`,
      );
    }
    return output;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- dokumenty --------------------------------------------------------------

interface SourceDocument {
  readonly label: string;
  readonly source: string;
  readonly html: Buffer;
}

function documentsFromFiles(files: readonly string[]): SourceDocument[] {
  const absolute = files.map((f) => resolve(f));
  const names = absolute.map((f) => basename(f));
  const unique = new Set(names).size === names.length;
  return absolute.map((file, i) => {
    if (!existsSync(file)) throw new ConformanceSetupError(`--html ${files[i]}: brak pliku.`);
    return {
      label: unique ? names[i] : relative(process.cwd(), file) || names[i],
      source: `plik ${file}`,
      html: readFileSync(file),
    };
  });
}

/** Render z artefaktu jak `sampleArtifact` w `check-document-weight.ts` (fixture, rozgrzany HIT). */
async function documentsFromArtifact(
  root: string,
  paths: readonly string[],
): Promise<SourceDocument[]> {
  // Import leniwy: tryb `--html` nie ładuje warstwy serwera artefaktu.
  const { DEFAULT_ACCEPT_LANGUAGE, freePort, startArtifact, warmDocument } =
    await import("./artifactServer.ts");
  const port = await freePort();
  const artifact = await startArtifact({
    root,
    port,
    fixture: true,
    measurementCase: MEASUREMENT_CASE,
  });
  try {
    const documents: SourceDocument[] = [];
    for (const path of paths) {
      const warm = await warmDocument(artifact.origin, path, DEFAULT_ACCEPT_LANGUAGE);
      if (warm.status !== 200) {
        throw new ConformanceSetupError(
          `GET ${path} -> HTTP ${warm.status} (location: ${warm.headers.get("location") ?? "-"}). ` +
            "Raport sprawdza dokument PL bez przekierowania - sprawdź Accept-Language i fixture.",
        );
      }
      documents.push({
        label: path,
        source: `artefakt ${root}, GET ${path} (fixture ${MEASUREMENT_CASE}, x-nes-cache ${warm.headers.get("x-nes-cache") ?? "-"})`,
        html: warm.body,
      });
    }
    return documents;
  } finally {
    await artifact.stop();
  }
}

// --- raport -----------------------------------------------------------------

interface DocumentReport {
  readonly label: string;
  readonly source: string;
  readonly summary: DocumentSummary;
  readonly messages: readonly ClassifiedMessage[];
}

const KIND_ORDER: Record<MessageKind, number> = { error: 0, warning: 1, info: 2 };

function printSummaryTable(reports: readonly DocumentReport[]): void {
  const width = Math.min(48, Math.max(8, ...reports.map((r) => r.label.length)));
  const label = (text: string) =>
    (text.length > width ? `…${text.slice(-(width - 1))}` : text).padEnd(width);
  const cells = (c: VerdictCounts) =>
    [c.total, c.accepted, c.knownDebt, c.new].map((n) => String(n).padStart(8)).join("");
  console.log(
    `\n  ${"dokument".padEnd(width)} ${"rodzaj".padEnd(8)}` +
      ["razem", "akcept.", "dług", "NOWE"].map((h) => h.padStart(8)).join(""),
  );
  for (const report of reports) {
    KINDS.forEach((kind, i) => {
      console.log(
        `  ${label(i === 0 ? report.label : "")} ${kind.padEnd(8)}${cells(report.summary[kind])}`,
      );
    });
    console.log(`  ${label("")} ${"(suma)".padEnd(8)}${cells(report.summary.all)}`);
  }
}

function printEntryUsage(entries: readonly CompiledEntry[], reports: readonly DocumentReport[]) {
  const counts = new Map<string, number>(entries.map((e) => [e.id, 0]));
  for (const report of reports) {
    for (const m of report.messages) {
      if (m.entryId) counts.set(m.entryId, (counts.get(m.entryId) ?? 0) + 1);
    }
  }
  const width = Math.max(...entries.map((e) => e.id.length));
  console.log("\nDopasowania listy (wszystkie dokumenty):");
  for (const entry of entries) {
    const group = entry.group === "accepted" ? "akceptowane" : "dług znany";
    console.log(
      `  ${group.padEnd(12)} ${entry.id.padEnd(width)} ${String(counts.get(entry.id) ?? 0).padStart(6)}`,
    );
  }
  const unused = entries.filter((e) => !counts.get(e.id)).map((e) => e.id);
  if (unused.length) {
    console.log(
      `  bez dopasowań w tym przebiegu: ${unused.join(", ")} ` +
        "(jeśli stale - dług spłacony albo odstępstwo usunięte: wpis do skasowania)",
    );
  }
}

function printNewMessages(report: DocumentReport): void {
  const fresh = report.messages.filter((m) => m.verdict === "new");
  if (!fresh.length) {
    console.log(`\nNOWE komunikaty - ${report.label}: brak`);
    return;
  }
  const s = report.summary;
  console.log(
    `\nNOWE komunikaty - ${report.label}: ${fresh.length} ` +
      `(error ${s.error.new}, warning ${s.warning.new}, info ${s.info.new})`,
  );
  const groups = new Map<string, ClassifiedMessage[]>();
  for (const m of fresh) {
    const key = `${m.kind}\u0000${m.message}`;
    const list = groups.get(key);
    if (list) list.push(m);
    else groups.set(key, [m]);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => KIND_ORDER[a[0].kind] - KIND_ORDER[b[0].kind],
  );
  for (const list of ordered) {
    const first = list[0];
    console.log(`  ${first.kind} x${list.length}  ${first.message}`);
    for (const m of list.slice(0, MAX_EXAMPLES)) {
      console.log(`      ${`${m.line ?? "?"}:${m.column ?? "?"}`.padEnd(12)} ${formatExtract(m)}`);
    }
    if (list.length > MAX_EXAMPLES) {
      console.log(`      … i jeszcze ${list.length - MAX_EXAMPLES} (komplet w --json)`);
    }
  }
}

async function main(): Promise<void> {
  const { values: opts } = parseArgs({
    options: {
      html: { type: "string", multiple: true },
      root: { type: "string" },
      path: { type: "string", multiple: true },
      json: { type: "string" },
      strict: { type: "boolean", default: false },
      allowlist: { type: "string" },
    },
  });
  const allowlistPath = resolve(opts.allowlist ?? DEFAULT_ALLOWLIST);
  const entries = loadAllowlist(allowlistPath);

  const java = javaBinary();
  assertJava(java);
  const jar = resolveVnuJar();

  const htmlFiles = opts.html ?? [];
  const documents = documentsFromFiles(htmlFiles);
  if (!htmlFiles.length || opts.root !== undefined) {
    const root = resolve(opts.root ?? process.cwd());
    const paths = opts.path?.length ? opts.path : ["/"];
    documents.push(...(await documentsFromArtifact(root, paths)));
  }

  let vnuVersion: string | null = null;
  const reports: DocumentReport[] = [];
  for (const doc of documents) {
    const output = runVnu(java, jar, doc.html);
    vnuVersion ??= output.version;
    const messages = classifyMessages(output.messages, entries);
    reports.push({ label: doc.label, source: doc.source, summary: summarize(messages), messages });
  }

  const versionNote = vnuVersion ?? "wersja nieznana";
  console.log(
    `Zgodność HTML: vnu ${versionNote}, --also-check-css; tryb ${opts.strict ? "--strict" : "raportu"}`,
  );
  console.log(`lista: ${relative(process.cwd(), allowlistPath) || allowlistPath}`);
  for (const report of reports) console.log(`  ${report.label}: ${report.source}`);
  if (vnuVersion && !vnuVersion.startsWith(`${VNU_VERSION} `) && vnuVersion !== VNU_VERSION) {
    console.warn(
      `⚠ vnu ${vnuVersion} zamiast przypiętego ${VNU_VERSION} - treść komunikatów może się różnić od wzorców listy.`,
    );
  }
  printSummaryTable(reports);
  printEntryUsage(entries, reports);
  for (const report of reports) printNewMessages(report);

  const newErrors = reports.reduce((sum, r) => sum + countNewErrors(r.messages), 0);
  if (opts.json) {
    const jsonPath = resolve(opts.json);
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(
      jsonPath,
      `${JSON.stringify(
        {
          vnuVersion,
          pinnedVersion: VNU_VERSION,
          allowlist: allowlistPath,
          strict: opts.strict,
          newErrors,
          documents: reports,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nraport: ${jsonPath}`);
  }

  if (opts.strict && newErrors > 0) {
    console.error(`\n✗ NOWE błędy zgodności HTML: ${newErrors} (--strict)`);
    process.exitCode = 1;
  } else {
    console.log(
      `\nNOWE błędy: ${newErrors}` +
        (opts.strict ? "" : " (tryb raportu - kod wyjścia 0; --strict kończy się kodem 1)"),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    if (error instanceof ConformanceSetupError) console.error(`✗ ${error.message}`);
    else console.error(error instanceof Error ? (error.stack ?? error.message) : error);
    process.exitCode = 1;
  });
}
