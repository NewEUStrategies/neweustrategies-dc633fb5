// Pamięć kodów w karcie przeglądarki: kod wydarzenia (kupon) i kod dostępu
// wejściówki leżą w OSOBNYCH szufladach - kod dostępu wpisany w formularzu
// nie może wrócić w kasie jako kupon.
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  recallAccessCodeHint,
  recallEventCode,
  recallTicketAccessCode,
  rememberEventCode,
  rememberTicketAccessCode,
} from "@/lib/events/eventCodeMemory";

const EVENT = "11111111-1111-4111-8111-111111111111";
const TICKET = "22222222-2222-4222-8222-222222222222";
const OTHER_TICKET = "33333333-3333-4333-8333-333333333333";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("kod wydarzenia", () => {
  it("zapisuje kod znormalizowany (przycięty, wielkie litery, do 64 znaków)", () => {
    rememberEventCode(EVENT, `  vip-${"x".repeat(80)} `);
    expect(recallEventCode(EVENT)).toBe(`VIP-${"X".repeat(60)}`);
  });

  it("bez zapisu oddaje pusty napis", () => {
    expect(recallEventCode(EVENT)).toBe("");
  });
});

describe("kod dostępu wejściówki", () => {
  it("trzyma kod osobno dla każdej wejściówki i osobno od kodu wydarzenia", () => {
    rememberEventCode(EVENT, "odslon");
    rememberTicketAccessCode(EVENT, TICKET, " partner ");
    expect(recallTicketAccessCode(EVENT, TICKET)).toBe("PARTNER");
    expect(recallTicketAccessCode(EVENT, OTHER_TICKET)).toBe("");
    expect(recallEventCode(EVENT)).toBe("ODSLON");
  });

  it("podpowiedź: kod wejściówki wygrywa z kodem wydarzenia", () => {
    rememberEventCode(EVENT, "odslon");
    rememberTicketAccessCode(EVENT, TICKET, "partner");
    expect(recallAccessCodeHint(EVENT, TICKET)).toBe("PARTNER");
  });

  it("podpowiedź: bez kodu wejściówki zostaje kod wydarzenia z linku", () => {
    rememberEventCode(EVENT, "zaproszenie");
    expect(recallAccessCodeHint(EVENT, TICKET)).toBe("ZAPROSZENIE");
  });

  it("podpowiedź: pusta pamięć daje pusty napis", () => {
    expect(recallAccessCodeHint(EVENT, TICKET)).toBe("");
  });
});

describe("prywatny tryb (sessionStorage rzuca)", () => {
  it("zapis nie wywraca formularza, a odczyt oddaje pusty napis", () => {
    // Safari z zablokowanymi danymi witryn rzuca już przy SAMYM dostępie
    // do `window.sessionStorage`.
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => rememberEventCode(EVENT, "vip")).not.toThrow();
    expect(() => rememberTicketAccessCode(EVENT, TICKET, "partner")).not.toThrow();
    expect(recallEventCode(EVENT)).toBe("");
    expect(recallTicketAccessCode(EVENT, TICKET)).toBe("");
    expect(recallAccessCodeHint(EVENT, TICKET)).toBe("");
  });
});
