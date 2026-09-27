// Mapy etykiet KLONU EDYCJI.
//
// CO KONKRETNIE PSUJE SIĘ BEZ TYCH TESTÓW.
//   1. NOWY KOD Z BAZY ZNIKA. Ostrzeżenie o kodzie, którego bundle nie zna, ma
//      dostać zdanie ogólne z liczbą - zniknięcie z listy ukrywa ryzyko.
//   2. ZERO JAKO POZYCJA. „Skopiowane: sale 0" nic nie mówi i wypycha ważne
//      pozycje poza ekran.
//   3. KLUCZ SPOZA SŁOWNIKA. Każdy literał mapy musi istnieć w nakładce PL i EN
//      (sprawdzamy tu przez `i18n.exists` na prawdziwej instancji).
//   4. PRZEŁĄCZNIK I OPCJA ROZJECHANE Z API. Mapy są `Record` po kluczach z
//      `eventCloneApi` - ten test pilnuje, że żaden klucz nie ma pustej etykiety.
import { describe, expect, it } from "vitest";

import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-event-clone";
import { CLONE_FLAG_KEYS, CLONE_INCLUDE_KEYS } from "@/lib/events/eventCloneApi";
import {
  CLONE_INCLUDE_COUNT_KEYS,
  CLONE_INCLUDE_HINT_KEYS,
  CLONE_INCLUDE_LABEL_KEYS,
  CLONE_ITEM_LABEL_KEYS,
  CLONE_OPTION_FLAGS,
  CLONE_OPTION_HINT_KEYS,
  CLONE_OPTION_LABEL_KEYS,
  CLONE_OPTION_REQUIRES,
  CLONE_STATUS_LABEL_KEYS,
  cloneBlockerKey,
  cloneItemEntries,
  cloneStatusKey,
  cloneWarningKey,
} from "@/lib/events/eventCloneLabels";

function inBothLanguages(key: string): boolean {
  return (
    i18n.exists(key, { lng: "pl", fallbackLng: false }) &&
    i18n.exists(key, { lng: "en", fallbackLng: false })
  );
}

describe("mapy etykiet", () => {
  it("każdy przełącznik sekcji ma etykietę, podpowiedź i znane liczniki", () => {
    for (const key of CLONE_INCLUDE_KEYS) {
      expect(inBothLanguages(CLONE_INCLUDE_LABEL_KEYS[key]), key).toBe(true);
      expect(inBothLanguages(CLONE_INCLUDE_HINT_KEYS[key]), key).toBe(true);
      for (const item of CLONE_INCLUDE_COUNT_KEYS[key]) {
        expect(CLONE_ITEM_LABEL_KEYS[item], `${key}.${item}`).toBeDefined();
      }
    }
  });

  it("każda opcja ma etykietę, podpowiedź i sekcję, od której zależy", () => {
    for (const flag of CLONE_OPTION_FLAGS) {
      expect(CLONE_FLAG_KEYS).toContain(flag);
      expect(inBothLanguages(CLONE_OPTION_LABEL_KEYS[flag]), flag).toBe(true);
      expect(inBothLanguages(CLONE_OPTION_HINT_KEYS[flag]), flag).toBe(true);
      expect(CLONE_INCLUDE_KEYS).toContain(CLONE_OPTION_REQUIRES[flag]);
    }
  });

  it("wszystkie rzeczowniki liczników i stany istnieją w obu językach", () => {
    for (const key of [
      ...Object.values(CLONE_ITEM_LABEL_KEYS),
      ...Object.values(CLONE_STATUS_LABEL_KEYS),
    ]) {
      expect(inBothLanguages(key), key).toBe(true);
    }
  });
});

describe("cloneItemEntries", () => {
  it("niezerowe znane liczniki w kolejności mapy, obce klucze pominięte", () => {
    expect(cloneItemEntries({ sessions: 3, groups: 5, rooms: 0, nieznane: 7 })).toEqual([
      { id: "groups", labelKey: "adminEventClone.items.groups", count: 5 },
      { id: "sessions", labelKey: "adminEventClone.items.sessions", count: 3 },
    ]);
  });

  it("ustawienia uczestnika, zakładki, zapisy na sesje i przepustki mają etykiety w kolejności mapy", () => {
    expect(
      cloneItemEntries({
        wallet_passes: 2,
        participant_settings: 1,
        session_signups: 4,
        session_saves: 3,
        groups: 5,
      }),
    ).toEqual([
      { id: "groups", labelKey: "adminEventClone.items.groups", count: 5 },
      {
        id: "participant_settings",
        labelKey: "adminEventClone.items.participantSettings",
        count: 1,
      },
      { id: "session_saves", labelKey: "adminEventClone.items.sessionSaves", count: 3 },
      { id: "session_signups", labelKey: "adminEventClone.items.sessionSignups", count: 4 },
      { id: "wallet_passes", labelKey: "adminEventClone.items.walletPasses", count: 2 },
    ]);
  });

  it("zawężenie do podanej listy (także z kluczem spoza mapy i brakującym licznikiem)", () => {
    expect(
      cloneItemEntries({ registrations: 2, sessions: 4 }, ["registrations", "invoices", "obce"]),
    ).toEqual([{ id: "registrations", labelKey: "adminEventClone.items.registrations", count: 2 }]);
  });
});

describe("kody ostrzeżeń, blokad i stanów", () => {
  it("znany kod ma własne zdanie, nieznany - ogólne", () => {
    expect(cloneWarningKey({ code: "sales_closed", count: 2 })).toBe(
      "adminEventClone.warnings.salesClosed",
    );
    expect(cloneWarningKey({ code: "nowy_kod", count: 1 })).toBe(
      "adminEventClone.warnings.unknown",
    );
    expect(cloneBlockerKey({ code: "slug_taken", count: 1 })).toBe(
      "adminEventClone.blockers.slugTaken",
    );
    expect(cloneBlockerKey({ code: "nowa_blokada", count: 1 })).toBe(
      "adminEventClone.blockers.unknown",
    );
    for (const key of [
      cloneWarningKey({ code: "nowy_kod", count: 1 }),
      cloneBlockerKey({ code: "nowa_blokada", count: 1 }),
    ]) {
      expect(inBothLanguages(key)).toBe(true);
    }
  });

  it("stan spoza CHECK-a opisywany jako szkic", () => {
    expect(cloneStatusKey("published")).toBe("adminEventClone.status.published");
    expect(cloneStatusKey("archived")).toBe("adminEventClone.status.draft");
  });
});
