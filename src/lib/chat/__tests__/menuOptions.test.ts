// Katalog opcji menu rozmowy. Mały moduł, ale pilnuje SPÓJNOŚCI Z BAZĄ:
// zbiór okien znikania wiadomości w UI musi pokrywać dokładnie lustro CHECK-a
// (`MESSAGE_TTL_OPTIONS`). Nowa wartość w migracji bez etykiety pokazałaby się
// użytkownikowi pod niepoprawną nazwą - i to jest jedyne miejsce, w którym da
// się to złapać przed produkcją.
import { describe, expect, it } from "vitest";
import { MUTE_OPTIONS, TTL_MENU_OPTIONS, ttlLabelKey } from "../menuOptions";
import { isValidMessageTtl, MESSAGE_TTL_OPTIONS } from "../receipts";

describe("MUTE_OPTIONS", () => {
  it("oferuje 8 h, tydzień i wyciszenie na zawsze w sekundach", () => {
    expect(MUTE_OPTIONS.map((option) => option.seconds)).toEqual([28800, 604800, -1]);
  });

  it("każde okno ma własny, niepusty klucz i18n", () => {
    const keys = MUTE_OPTIONS.map((option) => option.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key.startsWith("chat.menu.mute")).toBe(true);
  });

  it("wyciszenie na zawsze jest sygnalizowane -1, nie ogromną liczbą sekund", () => {
    // RPC `chat_set_muted` rozumie -1 jako `infinity`; podanie np. 10 lat
    // w sekundach dałoby wyciszenie, które kiedyś cicho wygasa.
    expect(MUTE_OPTIONS.at(-1)?.seconds).toBe(-1);
  });
});

describe("TTL_MENU_OPTIONS", () => {
  it("zaczyna się od pozycji wyłączonej i dalej idzie DOKŁADNIE lustro CHECK-a", () => {
    expect(TTL_MENU_OPTIONS[0]).toBeNull();
    expect(TTL_MENU_OPTIONS.slice(1)).toEqual([...MESSAGE_TTL_OPTIONS]);
  });

  it("każda pozycja jest wartością akceptowaną przez walidator TTL", () => {
    for (const option of TTL_MENU_OPTIONS) {
      expect(isValidMessageTtl(option)).toBe(true);
    }
  });
});

describe("ttlLabelKey", () => {
  it("mapuje każde okno z lustra CHECK-a na WŁASNY klucz", () => {
    const keys = TTL_MENU_OPTIONS.map(ttlLabelKey);
    expect(new Set(keys).size).toBe(TTL_MENU_OPTIONS.length);
  });

  it("nazywa okna po ludzku: wyłączone, dzień, tydzień, kwartał", () => {
    expect(ttlLabelKey(null)).toBe("chat.disappearing.off");
    expect(ttlLabelKey(86400)).toBe("chat.disappearing.day");
    expect(ttlLabelKey(604800)).toBe("chat.disappearing.week");
    expect(ttlLabelKey(7776000)).toBe("chat.disappearing.quarter");
  });

  it("wartość spoza lustra NIE dostaje wymyślonej etykiety", () => {
    // Etykieta „kwartał" dla nieznanego okna kłamałaby o czasie życia
    // wiadomości. „Wyłączone" jest jedyną, która nie obiecuje nic fałszywego.
    expect(ttlLabelKey(3600)).toBe("chat.disappearing.off");
    expect(ttlLabelKey(-1)).toBe("chat.disappearing.off");
  });
});
