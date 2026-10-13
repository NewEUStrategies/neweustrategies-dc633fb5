// @vitest-environment node
// BRAMKA: platformy dziennika wydań w TS == CHECK w bazie; kształt
// identyfikatora obiektu Google w TS == wyprowadzenie starego identyfikatora
// w migracji (F8).
//
// CO KONKRETNIE PSUJE SIĘ BEZ TEGO TESTU. `_event_wallet_pass_note` odrzuca
// platformę spoza `event_wallet_passes_platform_values` - a trasa traktuje
// dziennik jako best-effort, więc rozjazd nie dałby błędu uczestnikowi, tylko
// CICHO puste wiersze dziennika, na których ma się oprzeć późniejsza
// dezaktywacja przepustek Google po anulowaniu zgłoszenia.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GOOGLE_CONFIG_FIXTURE, WALLET_QR } from "@/test/events/walletFixtures";

import { googleObjectId, legacyGoogleObjectId, walletObjectSuffix } from "../googleWallet.server";
import { WALLET_PLATFORMS } from "../walletRoutes.server";

const DIR = join(process.cwd(), "supabase", "migrations");

/** Ostatnia definicja ograniczenia w łańcuchu migracji (kolejność nazw plików). */
function lastCheckValues(constraint: string): string[] {
  let values: string[] = [];
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const at = sql.lastIndexOf(`CONSTRAINT ${constraint} CHECK`);
    if (at === -1) continue;
    const list = sql.slice(at, sql.indexOf(")", at));
    values = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  }
  return values;
}

describe("platformy portfela", () => {
  it("WALLET_PLATFORMS to dokładnie wartości CHECK-a dziennika wydań", () => {
    expect(lastCheckValues("event_wallet_passes_platform_values")).toEqual([...WALLET_PLATFORMS]);
  });
});

/** Ciało NAJNOWSZEJ definicji funkcji w łańcuchu migracji. */
function lastFunctionBody(name: string): string {
  let body = "";
  for (const file of readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    const sql = readFileSync(join(DIR, file), "utf8");
    const at = sql.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
    if (at === -1) continue;
    const start = sql.indexOf("$$", at);
    body = sql.slice(start, sql.indexOf("$$", start + 2));
  }
  return body;
}

describe("identyfikator obiektu Google sprzed OPS-14", () => {
  // CO SIĘ PSUJE BEZ TEGO TESTU. Migracja odtwarza obiekt sprzed OPS-14,
  // obcinając identyfikator z kodem o `.` + sufiks. Zmiana długości sufiksu
  // w TS bez migracji dałaby cicho ZŁY identyfikator - PATCH na nieistniejący
  // obiekt kończy się 404 (traktowane jako sukces), a prawdziwy stary obiekt
  // zostaje ACTIVE.
  it("migracja obcina dokładnie `.` + sufiks z TS i rozpoznaje jego kształt", async () => {
    const body = lastFunctionBody("_event_wallet_pass_queue_legacy_google_objects");
    const suffix = await walletObjectSuffix(WALLET_QR);
    const registrationId = "52b00000-0000-0000-0000-0000000000a1";
    const withCode = googleObjectId(GOOGLE_CONFIG_FIXTURE.issuerId, registrationId, suffix);
    const cut = Number(/char_length\(w\.object_id\) - (\d+)/.exec(body)?.[1]);
    expect(cut).toBe(suffix.length + 1);
    expect(withCode.slice(0, -cut)).toBe(
      legacyGoogleObjectId(GOOGLE_CONFIG_FIXTURE.issuerId, registrationId),
    );
    const shape = /'\\\.\[0-9a-f\]\{(\d+)\}\$'/.exec(body);
    expect(Number(shape?.[1])).toBe(suffix.length);
  });
});
