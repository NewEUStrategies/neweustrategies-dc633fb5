// Bramka: KAŻDY SMS wychodzi przez `sendParticipantSms` (REG-10, decyzja D12).
//
// CO TO ZA RYZYKO. `sendSms` (`@/lib/notify/sms.server`) zna tylko operatora
// i dziennik idempotencji. Wyłącznik platformy (`EVENT_SMS_ENABLED`), treść
// w GSM-7 w jednym segmencie i budżet najemcy (fail-closed) mieszkają piętro
// wyżej, w `@/lib/events/participantNotify.server`. Wołający, który sięga po
// `sendSms` wprost, omija wszystkie trzy naraz - dokładnie tak SMS o płatności
// wychodził przy samym tokenie operatora, z ogonkami w tytule (UCS-2, kilka
// płatnych segmentów) i bez budżetu (`registrationOutcomeNotify.server.ts`
// przed naprawą: dwa `await import(...sms.server)` z `{ sendSms }`).
//
// DLACZEGO DRZEWO SKŁADNI, A NIE WYRAŻENIA REGULARNE (przegląd R67). Pierwsza
// wersja bramki szukała kilku kształtów importu wyrażeniami regularnymi i nie
// widziała obejść, które kompilator przyjmuje bez słowa:
// `(await import("…sms.server")).sendSms(…)`, `import(…).then((m) => m.sendSms)`,
// `export { sendSms } from …` / `export * from …` (przeładunek przez moduł
// pośredni) ani `fetch("https://api.smsapi.pl/…")` (transport napisany od
// nowa). Teraz bramka czyta drzewo składni TypeScriptu - komentarze się nie
// liczą, kod tak - i ma trzy reguły:
//   1. identyfikator albo napis `sendSms` wolno mieć wyłącznie w module
//      transportu i w `participantNotify.server.ts` (jedyne wyjście);
//   2. napis albo identyfikator `smsapi` (adres operatora) - wyłącznie
//      w module transportu; jedyny wyjątek to nazwa zmiennej `SMSAPI_TOKEN`
//      w jedynym wyjściu (wyłącznik platformy pyta, czy operator jest
//      skonfigurowany - bez adresu operatora token niczego nie wyśle);
//   3. z modułu transportu inni biorą najwyżej czyste formatery i typy:
//      bez przestrzeni nazw, bez importu dynamicznego bez listy nazw, bez
//      `require` i bez przeładunku (`export … from`).
//
// CO WOLNO INNYM: `normalizePhone`, `trimSmsBody` (czyste funkcje) i typy
// `SmsResult` / `SmsInput`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const TRANSPORT = "src/lib/notify/sms.server.ts";
const SINGLE_EXIT = "src/lib/events/participantNotify.server.ts";
const ALLOWED_NAMES: ReadonlySet<string> = new Set([
  "normalizePhone",
  "trimSmsBody",
  "SmsResult",
  "SmsInput",
]);

/** Specyfikator modułu transportu: alias albo ścieżka względna kończąca się na `sms.server`. */
function isTransportSpecifier(specifier: string): boolean {
  return (
    specifier === "@/lib/notify/sms.server" ||
    /^(?:\.{1,2}\/)+(?:[\w-]+\/)*sms\.server(?:\.ts)?$/.test(specifier)
  );
}

interface SmsExitFacts {
  /** Nazwy wzięte z modułu transportu; `*` = cały moduł bez listy nazw. */
  imports: string[];
  /** Ile razy kod (nie komentarz) nazywa `sendSms` - identyfikatorem albo napisem. */
  sendSmsRefs: number;
  /** Ile napisów i identyfikatorów zawiera `smsapi` (adres operatora) - poza `SMSAPI_TOKEN`. */
  smsapiRefs: number;
  /** Ile razy kod nazywa zmienną `SMSAPI_TOKEN` (wyłącznik platformy). */
  smsapiTokenRefs: number;
  /** Przeładunki z modułu transportu (`export { … } from`, `export * from`). */
  reexports: number;
}

function stringValue(node: ts.Node | undefined): string | null {
  return node !== undefined &&
    (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

/** Nazwy z `const { a, b: c } = await import(…)` albo `null`, gdy import nie jest tak rozpakowany. */
function destructuredNames(call: ts.CallExpression): string[] | null {
  const awaited = ts.isAwaitExpression(call.parent) ? call.parent : null;
  const declaration = awaited?.parent;
  if (
    awaited === null ||
    declaration === undefined ||
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer !== awaited ||
    !ts.isObjectBindingPattern(declaration.name)
  ) {
    return null;
  }
  const names: string[] = [];
  for (const element of declaration.name.elements) {
    if (element.dotDotDotToken !== undefined) return null; // `...reszta` = cały moduł
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key)) return null;
    names.push(key.text);
  }
  return names;
}

/** Fakty jednego pliku: czyta drzewo składni, komentarze nie istnieją. */
function scanSmsExit(source: string, fileName = "probe.ts"): SmsExitFacts {
  const facts: SmsExitFacts = {
    imports: [],
    sendSmsRefs: 0,
    smsapiRefs: 0,
    smsapiTokenRefs: 0,
    reexports: 0,
  };
  const operator = (text: string): void => {
    if (text === "SMSAPI_TOKEN") facts.smsapiTokenRefs += 1;
    else if (/smsapi/i.test(text)) facts.smsapiRefs += 1;
  };
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = stringValue(node.moduleSpecifier);
      if (specifier !== null && isTransportSpecifier(specifier)) {
        const clause = node.importClause;
        if (clause === undefined) facts.imports.push("*");
        if (clause?.name !== undefined) facts.imports.push("default");
        const bindings = clause?.namedBindings;
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) facts.imports.push("*");
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            facts.imports.push((element.propertyName ?? element.name).text);
          }
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier = stringValue(node.moduleSpecifier);
      if (specifier !== null && isTransportSpecifier(specifier)) facts.reexports += 1;
    } else if (ts.isCallExpression(node)) {
      const specifier = stringValue(node.arguments[0]);
      const dynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const required = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (specifier !== null && isTransportSpecifier(specifier) && (dynamicImport || required)) {
        const names = dynamicImport ? destructuredNames(node) : null;
        facts.imports.push(...(names ?? ["*"]));
      }
    } else if (ts.isIdentifier(node)) {
      if (node.text === "sendSms") facts.sendSmsRefs += 1;
      operator(node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (node.text.includes("sendSms")) facts.sendSmsRefs += 1;
      operator(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return facts;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
}

function productionFiles(): string[] {
  const out: string[] = [];
  walk(SRC, out);
  return out;
}

/** Naruszenia jednego pliku produkcyjnego (puste = plik czysty). */
function violations(rel: string, facts: SmsExitFacts): string[] {
  const out: string[] = [];
  if (rel === TRANSPORT) return out;
  if (facts.smsapiRefs > 0) out.push(`adres operatora (smsapi) x${facts.smsapiRefs}`);
  if (rel !== SINGLE_EXIT && facts.smsapiTokenRefs > 0) {
    out.push(`token operatora (SMSAPI_TOKEN) x${facts.smsapiTokenRefs}`);
  }
  if (facts.reexports > 0) out.push(`przeładunek modułu transportu x${facts.reexports}`);
  const allowed =
    rel === SINGLE_EXIT ? new Set([...ALLOWED_NAMES, "sendSms"]) : (ALLOWED_NAMES as Set<string>);
  const forbidden = facts.imports.filter((name) => !allowed.has(name));
  if (forbidden.length > 0) out.push(`import z transportu: ${forbidden.join(", ")}`);
  if (rel !== SINGLE_EXIT && facts.sendSmsRefs > 0) out.push(`sendSms x${facts.sendSmsRefs}`);
  return out;
}

describe("bramka jednego wyjścia SMS", () => {
  it("skaner rozpoznaje każdy kształt importu transportu", () => {
    // Bez tej kontroli zmiana składni importu (np. dynamiczny import)
    // dawałaby ZIELONĄ bramkę mierzącą pustkę.
    expect(scanSmsExit(`import { sendSms } from "@/lib/notify/sms.server";`).imports).toEqual([
      "sendSms",
    ]);
    expect(
      scanSmsExit(`const { sendSms } = await import("@/lib/notify/sms.server");`).imports,
    ).toEqual(["sendSms"]);
    expect(scanSmsExit(`import { sendSms as send } from "../notify/sms.server";`).imports).toEqual([
      "sendSms",
    ]);
    expect(
      scanSmsExit(`import type { SmsResult } from "@/lib/notify/sms.server";`).imports,
    ).toEqual(["SmsResult"]);
    expect(scanSmsExit(`import * as sms from "@/lib/notify/sms.server";`).imports).toEqual(["*"]);
    expect(scanSmsExit(`const m = await import("@/lib/notify/sms.server");`).imports).toEqual([
      "*",
    ]);
    expect(
      scanSmsExit(`const { normalizePhone, ...rest } = await import("@/lib/notify/sms.server");`)
        .imports,
    ).toEqual(["*"]);
    expect(scanSmsExit(`const m = require("../../lib/notify/sms.server");`).imports).toEqual(["*"]);
    expect(
      scanSmsExit(`import { sendTxEmail } from "@/lib/email/transactional.server";`).imports,
    ).toEqual([]);
  });

  // PRZEGLĄD R67: kształty, których wersja na wyrażeniach regularnych nie
  // widziała. Każdy z nich musi dać naruszenie w zwykłym pliku.
  it.each([
    [
      "wywołanie na module z importu dynamicznego",
      `export const go = async () => (await import("@/lib/notify/sms.server")).sendSms({ to: "1", body: "b" });`,
    ],
    [
      "import dynamiczny z .then",
      `export const go = () => import("@/lib/notify/sms.server").then((m) => m.sendSms);`,
    ],
    [
      "dostęp napisem do eksportu",
      `export const go = async () => { const m = await import("@/lib/notify/sms.server"); return m["sendSms"]; };`,
    ],
    ["przeładunek nazwany", `export { sendSms } from "@/lib/notify/sms.server";`],
    ["przeładunek całego modułu", `export * from "../notify/sms.server";`],
    [
      "transport napisany od nowa",
      `export const go = () => fetch("https://api.smsapi.pl/sms.do", { method: "POST" });`,
    ],
    ["adres operatora w szablonie", "export const url = (h: string) => `https://${h}.smsapi.pl`;"],
    ["własna funkcja o nazwie transportu", `export function sendSms() { return null; }`],
  ])("obejście: %s -> naruszenie", (_label, source) => {
    expect(violations("src/lib/events/probe.ts", scanSmsExit(source))).not.toEqual([]);
  });

  it("komentarze się nie liczą, formatery i typy wolno brać", () => {
    const source = [
      "// Dawniej: `sendSms` wprost i fetch na api.smsapi.pl.",
      "/* sendSms */",
      `import { normalizePhone, type SmsResult } from "@/lib/notify/sms.server";`,
      "export const to = (raw: string): string | null => normalizePhone(raw);",
      "export type R = SmsResult;",
    ].join("\n");
    expect(violations("src/lib/events/probe.ts", scanSmsExit(source))).toEqual([]);
  });

  it("token operatora czyta tylko jedyne wyjście (wyłącznik platformy)", () => {
    const killSwitch = "export const on = () => Boolean(process.env.SMSAPI_TOKEN);";
    expect(violations(SINGLE_EXIT, scanSmsExit(killSwitch))).toEqual([]);
    expect(violations("src/lib/events/probe.ts", scanSmsExit(killSwitch))).not.toEqual([]);
    expect(
      violations("src/lib/events/probe.ts", scanSmsExit(`const t = process.env["SMSAPI_TOKEN"];`)),
    ).not.toEqual([]);
  });

  it("jedyne wyjście może wziąć sendSms - ale nie przeładować transportu", () => {
    const exit = `const { sendSms } = await import("@/lib/notify/sms.server"); export const x = sendSms;`;
    expect(violations(SINGLE_EXIT, scanSmsExit(exit))).toEqual([]);
    expect(
      violations(SINGLE_EXIT, scanSmsExit(`export { sendSms } from "@/lib/notify/sms.server";`)),
    ).not.toEqual([]);
  });

  it("drzewo src: sendSms tylko w jedynym wyjściu, smsapi tylko w transporcie", () => {
    const files = productionFiles();
    // Pusty skan (zła ścieżka) wyglądałby jak sukces.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    let singleExitSeen = false;
    let transportSeen = false;
    for (const path of files) {
      const rel = relative(process.cwd(), path);
      const facts = scanSmsExit(readFileSync(path, "utf8"), path);
      if (rel === SINGLE_EXIT) singleExitSeen = facts.imports.includes("sendSms");
      if (rel === TRANSPORT) transportSeen = facts.smsapiRefs > 0 && facts.sendSmsRefs > 0;
      const found = violations(rel, facts);
      if (found.length > 0) offenders.push(`${rel}: ${found.join("; ")}`);
    }

    expect(offenders, "SMS tylko przez sendParticipantSms (participantNotify.server)").toEqual([]);
    // Jedyne wyjście i transport muszą naprawdę istnieć - inaczej bramka
    // pilnuje niczego.
    expect(singleExitSeen).toBe(true);
    expect(transportSeen).toBe(true);
    // Skan całego drzewa src nie mieści się w globalnym `testTimeout` 20 s
    // z zapasem: w shardzie CI trwał 14,8 s (b57d4872) i 15,0 s (27ee31c6),
    // a na a4b6f921 przekroczył 20 s pod obciążeniem runnera; w izolacji
    // lokalnie 9,8 s. Własna granica jak w pozostałych testach skanujących
    // drzewo (np. onConflictArbiters) - asercje bez zmian.
  }, 60_000);
});
