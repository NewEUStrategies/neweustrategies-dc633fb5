// ODMOWY PRZYJĘCIA ZAPROSZENIA PAKIETOWEGO -> zdania (REG-15).
//
// CO TU PILNUJEMY.
//
// 1) KODY NOWEGO CIAŁA MAJĄ ZDANIA. `event_package_invite_accept`
//    (20261012132200) odmawia teraz także `event_ended`, `order_refunded`,
//    `terms_required`, `missing_required_fields` i `missing_required_consents`.
//    Każdy z nich ma trafić w klucz, który stoi w słowniku PL i EN - inaczej
//    delegat zobaczy zdanie zapasowe i nie dowie się, co zrobić.
// 2) TON ZAPROSZENIA WYGRYWA TAM, GDZIE ZNACZENIE SIĘ RÓŻNI. `event_ended`
//    przy zapisie znaczy „zapisy są zamknięte", a przy zaproszeniu „zaproszenia
//    nie można przyjąć"; `already_registered` dotyczy osoby z zaproszenia, nie
//    wypełniającego formularz. Reszta spada do słownika zapisu.
// 3) PUDŁO WARTOŚCIĄ CZYTA SIĘ JAK DAWNY WYJĄTEK. `packageInviteApi` zamienia
//    `{ok:false, error:"invalid_token"}` na `invalid_token: invitation refused` -
//    ta sama głowa, to samo zdanie.
// 4) NIEZNANY KOD NIE UDAJE ZNANEGO. Treść z bazy nie przecieka na ekran.
import { describe, expect, it } from "vitest";

import { readKey, type ResourceTree } from "@/lib/ci/i18nParity";
import { packageInviteFailure } from "@/lib/events/publicRegistrationErrors";
import { eventRegistrationEn, eventRegistrationPl } from "@/lib/i18n-event-registration";

function maTekst(slownik: ResourceTree, klucz: string): boolean {
  const wartosc = readKey(slownik, klucz);
  return typeof wartosc === "string" && wartosc.trim() !== "";
}

describe("packageInviteFailure - kody przyjęcia zaproszenia", () => {
  it.each([
    ["event_ended: the event is over", "eventRegistration.invite.errors.eventEnded"],
    [
      "already_registered: this person already has an active registration",
      "eventRegistration.invite.errors.alreadyRegistered",
    ],
    [
      "order_refunded: the order behind this seat was refunded",
      "eventRegistration.errors.orderRefunded",
    ],
    [
      "order_cancelled: the order behind this seat is cancelled",
      "eventRegistration.errors.orderCancelled",
    ],
    ["event_cancelled: the event has been cancelled", "eventRegistration.errors.eventCancelled"],
    ["terms_required: epi_terms", "eventRegistration.errors.termsRequired"],
    ["missing_required_fields: sector", "eventRegistration.errors.missingRequiredFields"],
    ["missing_required_consents: rodo", "eventRegistration.errors.missingRequiredConsents"],
    ["seat_taken: this invitation has already been used", "eventRegistration.errors.seatTaken"],
    [
      "invitation_expired: the invitation has expired",
      "eventRegistration.errors.invitationExpired",
    ],
    ["invalid_token: invitation refused", "eventRegistration.errors.invalidToken"],
    ["rate_limited: invitation refused", "eventRegistration.errors.rateLimited"],
    [
      "consent_required: consent to data processing is required",
      "eventRegistration.errors.consentRequired",
    ],
  ])("%s -> %s (PL i EN)", (message, key) => {
    expect(packageInviteFailure(new Error(message)).key).toBe(key);
    expect(maTekst(eventRegistrationPl, key), `brak PL: ${key}`).toBe(true);
    expect(maTekst(eventRegistrationEn, key), `brak EN: ${key}`).toBe(true);
  });

  it("`event_ended` zaproszenia to INNE zdanie niż `event_ended` zapisu", () => {
    expect(readKey(eventRegistrationPl, "eventRegistration.invite.errors.eventEnded")).not.toBe(
      readKey(eventRegistrationPl, "eventRegistration.errors.eventEnded"),
    );
  });

  it("nieznany kod i treść bez kodu spadają do zdania zapasowego", () => {
    expect(packageInviteFailure(new Error("violates_check_constraint: x")).key).toBe(
      "eventRegistration.errors.unknown",
    );
    expect(packageInviteFailure(new Error("Failed to fetch")).key).toBe(
      "eventRegistration.errors.unknown",
    );
  });
});
