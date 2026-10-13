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
// DLACZEGO STATYCZNIE. Import transportu to decyzja w KODZIE, widoczna przy
// review - bramka czyta drzewo `src` i pozwala wziąć z modułu transportu
// wyłącznie czyste formatery i typy. Jedyny wyjątek to `participantNotify`.
//
// CO WOLNO INNYM: `normalizePhone`, `trimSmsBody` (czyste funkcje) i typy
// `SmsResult` / `SmsInput`. Import przestrzeni nazw (`import * as`) jest
// zabroniony, bo nie da się z niego odczytać, czego moduł używa.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const SINGLE_EXIT = "src/lib/events/participantNotify.server.ts";
const ALLOWED_NAMES: ReadonlySet<string> = new Set([
  "normalizePhone",
  "trimSmsBody",
  "SmsResult",
  "SmsInput",
]);

/** Specyfikator modułu transportu: alias albo ścieżka względna kończąca się na `sms.server`. */
const SPECIFIER = String.raw`["'](?:@\/lib\/notify\/sms\.server|(?:\.{1,2}\/)+(?:[\w-]+\/)*sms\.server)["']`;

/** Nazwy wzięte z modułu transportu w jednym pliku (`*` = przestrzeń nazw). */
function smsTransportImports(source: string): string[] {
  const names: string[] = [];
  const named = new RegExp(String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*${SPECIFIER}`, "g");
  const dynamic = new RegExp(
    // `[^{}]` - destrukturyzacja nie zaczyna się w `{` bloku `if (...) {` wyżej.
    String.raw`\{([^{}]*)\}\s*=\s*await\s+import\(\s*${SPECIFIER}\s*\)`,
    "g",
  );
  const namespace = new RegExp(
    String.raw`import\s+(?:type\s+)?\*\s+as\s+\w+\s+from\s*${SPECIFIER}`,
    "g",
  );
  // Dynamiczny import bez destrukturyzacji (`const m = await import(...)`).
  const bare = new RegExp(String.raw`=\s*await\s+import\(\s*${SPECIFIER}\s*\)`, "g");
  for (const pattern of [named, dynamic]) {
    for (const match of source.matchAll(pattern)) {
      for (const raw of (match[1] ?? "").split(",")) {
        // `type SmsResult`, `sendSms as send` -> nazwa eksportu.
        const name =
          raw
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+|:/)[0]
            ?.trim() ?? "";
        if (name !== "") names.push(name);
      }
    }
  }
  if (namespace.test(source)) names.push("*");
  const destructured = [...source.matchAll(dynamic)].length;
  if ([...source.matchAll(bare)].length > destructured) names.push("*");
  return names;
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

describe("bramka jednego wyjścia SMS", () => {
  it("skaner rozpoznaje każdy kształt importu transportu", () => {
    // Bez tej kontroli zmiana składni importu (np. dynamiczny import)
    // dawałaby ZIELONĄ bramkę mierzącą pustkę.
    expect(smsTransportImports(`import { sendSms } from "@/lib/notify/sms.server";`)).toEqual([
      "sendSms",
    ]);
    expect(
      smsTransportImports(`const { sendSms } = await import("@/lib/notify/sms.server");`),
    ).toEqual(["sendSms"]);
    expect(smsTransportImports(`import { sendSms as send } from "../notify/sms.server";`)).toEqual([
      "sendSms",
    ]);
    expect(
      smsTransportImports(`import type { SmsResult } from "@/lib/notify/sms.server";`),
    ).toEqual(["SmsResult"]);
    expect(smsTransportImports(`import * as sms from "@/lib/notify/sms.server";`)).toEqual(["*"]);
    expect(smsTransportImports(`const m = await import("@/lib/notify/sms.server");`)).toEqual([
      "*",
    ]);
    expect(
      smsTransportImports(`import { sendTxEmail } from "@/lib/email/transactional.server";`),
    ).toEqual([]);
  });

  it("jedyny moduł z `sendSms` to participantNotify.server", () => {
    const files = productionFiles();
    // Pusty skan (zła ścieżka) wyglądałby jak sukces.
    expect(files.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    let singleExitSeen = false;
    for (const path of files) {
      const rel = relative(process.cwd(), path);
      const names = smsTransportImports(readFileSync(path, "utf8"));
      if (names.length === 0) continue;
      if (rel === SINGLE_EXIT) {
        singleExitSeen = names.includes("sendSms");
        continue;
      }
      const forbidden = names.filter((name) => !ALLOWED_NAMES.has(name));
      if (forbidden.length > 0) offenders.push(`${rel}: ${forbidden.join(", ")}`);
    }

    expect(offenders, "SMS tylko przez sendParticipantSms (participantNotify.server)").toEqual([]);
    // Jedyne wyjście musi naprawdę istnieć - inaczej bramka pilnuje niczego.
    expect(singleExitSeen).toBe(true);
  });
});
