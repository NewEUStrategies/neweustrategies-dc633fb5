// Czyste reguły plakietki stanu zgłoszenia (`participantSurface.ts`).
//
// CO TEN PLIK DOWODZI:
//  1. Każdy status z CHECK `event_registrations.status` ma ton, `approved`
//     i `attended` są AKTYWNE (D0-5), a status nieznany (także nazwy
//     z prototypu obiektu) nie ma tonu.
//  2. Mapa etykiet ma PEŁNE literały kluczy (bramka `eventsI18nKeys` widzi
//     każdy liść; prawdziwe zdania sprawdza `participantEnumMapsI18n.test.tsx`).
import { describe, expect, it } from "vitest";

import {
  REGISTRATION_STATUS_TONE,
  REGISTRATION_STATUS_TONE_LABEL_KEYS,
  registrationStatusTone,
} from "@/lib/events/participantSurface";

describe("registrationStatusTone", () => {
  it.each([
    ["approved", "active"],
    ["attended", "active"],
    ["pending", "pending"],
    ["draft", "pending"],
    ["waitlist", "waitlist"],
    ["cancelled", "closed"],
    ["rejected", "closed"],
    ["no_show", "closed"],
  ] as const)("%s -> %s", (status, tone) => {
    expect(registrationStatusTone(status)).toBe(tone);
  });

  it("mapa obejmuje dokładnie osiem statusów tabeli", () => {
    expect(Object.keys(REGISTRATION_STATUS_TONE)).toHaveLength(8);
  });

  it("status nieznany, dawne `confirmed`/`paid` i nazwy z prototypu nie mają tonu", () => {
    for (const status of [
      "confirmed",
      "registered",
      "paid",
      "unknown",
      "constructor",
      "toString",
      "",
    ]) {
      expect(registrationStatusTone(status)).toBeNull();
    }
  });

  it("każdy ton ma pełny literał klucza pod `eventParticipant.status`", () => {
    expect(REGISTRATION_STATUS_TONE_LABEL_KEYS).toEqual({
      active: "eventParticipant.status.active",
      pending: "eventParticipant.status.pending",
      waitlist: "eventParticipant.status.waitlist",
      closed: "eventParticipant.status.closed",
    });
  });
});
