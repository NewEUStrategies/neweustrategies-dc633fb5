// Rdzeń języka (`locale/pl.ts`, `locale/en.ts`) NIE niesie słowników panelu.
//
// PO CO TEN PLIK. Rdzeń to chunk, na który każdy czytelnik czeka przed
// hydratacją, a bramka `check:bundle` liczy oba języki do PUBLIC. Do
// 2026-10-17 ~60% jego bajtów to były `admin.*` i `blocks.*` (pomiar:
// pl 27,5 -> 5,7 KB, en 24,0 -> 4,8 KB gzip po przeniesieniu do nakładek
// `i18n-admin-core` i `i18n-admin-blocks`). Żadna inna bramka nie wskaże
// PRZYCZYNY powrotu tych gałęzi: parytet, dryf kluczy i integralność nakładek
// patrzą na scalone drzewo, a `check:bundle` widzi tylko kilobajty i to
// dopiero na mainie. Ten test mówi wprost: klucz panelu dopisany do rdzenia.
import { describe, expect, it } from "vitest";
import { pl } from "@/lib/locale/pl";
import { en } from "@/lib/locale/en";
import { adminCoreEn, adminCorePl } from "@/lib/i18n-admin-core";
import { blocksCoreEn, blocksCorePl } from "@/lib/i18n-admin-blocks";

/**
 * Jedyne `admin.*` w rdzeniu: `UnsavedChangesGuardDialog` montuje się także
 * poza panelem, więc nie może czekać na nakładkę rejestrowaną w `AdminSession`.
 */
const GUARD_DIALOG_KEYS = ["leave", "stay", "unsavedChanges", "unsavedChangesTitle"];

describe.each([
  ["pl", pl, adminCorePl, blocksCorePl],
  ["en", en, adminCoreEn, blocksCoreEn],
] as const)("rdzeń %s", (_lang, core, adminOverlay, blocksOverlay) => {
  it("z `admin.*` niesie wyłącznie klucze dialogu niezapisanych zmian", () => {
    expect(Object.keys(core.admin).sort()).toEqual(GUARD_DIALOG_KEYS);
  });

  it("nie niesie `blocks.*` - edytor bloków ma własną nakładkę", () => {
    expect(core).not.toHaveProperty("blocks");
  });

  it("klucze dialogu są w rdzeniu RAZ - nakładka panelu ich nie kopiuje", () => {
    for (const key of GUARD_DIALOG_KEYS) {
      expect(adminOverlay.admin, key).not.toHaveProperty(key);
    }
  });

  it("nakładki niosą przeniesione gałęzie (kontrola narzędzia)", () => {
    expect(Object.keys(adminOverlay.admin).length).toBeGreaterThan(50);
    expect(Object.keys(blocksOverlay.blocks).length).toBeGreaterThan(10);
  });
});
