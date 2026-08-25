// Regula powierzchni zapisow: KAZDY wariant i KAZDE rozstrzygniecie
// pierwszenstwa.
//
// Po co tak drobiazgowo. Defekt, ktory ten modul zamyka, byl niewidoczny dla
// calej warstwy kontrolnej repozytorium: typy sie zgadzaly, slowniki mialy
// parytet, bramki swiecily na zielono, a uczestnik dostawal przycisk, ktory
// zawsze konczyl sie bledem. Jedyna rzecza, ktora umie to zlapac, jest test
// mowiacy WPROST: przy trybie `form` nie ma kontrolki zapisu.
import { describe, expect, it } from "vitest";

import {
  canSignalInterest,
  EVENT_REGISTRATION_STATES,
  isEventRegistrationState,
  isLegacyRsvpDecision,
  resolveRegistrationSurface,
  rsvpRefusalMessageKey,
  waitlistPositionOf,
  type RegistrationSurface,
  type RegistrationSurfaceInput,
} from "@/lib/events/registrationSurface";

/** Wydarzenie w najprostszym mozliwym stanie: zapisy jednym klikniciem, otwarte. */
const OPEN: RegistrationSurfaceInput = {
  registrationMode: "rsvp",
  registrationFlow: "instant",
  registrationState: "open",
  externalRegistrationUrl: null,
  seatsLeft: 12,
  myRegistrationStatus: null,
  myRsvpStatus: null,
  myWaitlistPosition: null,
  tierLocked: false,
  chathamHouseLocked: false,
  hasEnded: false,
  isSignedIn: true,
};

function surface(patch: Partial<RegistrationSurfaceInput>): RegistrationSurface {
  return resolveRegistrationSurface({ ...OPEN, ...patch });
}

describe("resolveRegistrationSurface: slownik stanu z bazy", () => {
  it("zna dokladnie osiem wartosci registration_state z event_page_header", () => {
    expect([...EVENT_REGISTRATION_STATES]).toEqual([
      "open",
      "event_cancelled",
      "event_ended",
      "registration_disabled",
      "registration_external",
      "registration_not_open",
      "membership_required",
      "sold_out",
    ]);
    for (const state of EVENT_REGISTRATION_STATES) {
      expect(isEventRegistrationState(state)).toBe(true);
    }
    expect(isEventRegistrationState("registration_form")).toBe(false);
  });

  it("zamyka zapisy przy stanie, ktorego ten klient nie zna", () => {
    const result = surface({ registrationState: "some_future_state" });
    expect(result.kind).toBe("closedUnknown");
    expect(result.control).toBeNull();
  });
});

describe("resolveRegistrationSurface: zapisy otwarte", () => {
  it("otwarte zapisy daja czynna kontrolke zapisu", () => {
    const result = surface({});
    expect(result.kind).toBe("open");
    expect(result.control).toEqual({
      action: "rsvp",
      labelKey: "eventFront.registrationAction.register",
      enabled: true,
    });
  });

  it("brak limitu miejsc (NULL) nie jest komplet", () => {
    expect(surface({ seatsLeft: null }).kind).toBe("open");
  });

  it("brak miejsc daje LISTE REZERWOWA, a nie blad", () => {
    const result = surface({ registrationState: "sold_out", seatsLeft: 0 });
    expect(result.kind).toBe("soldOut");
    expect(result.control).toEqual({
      action: "waitlist",
      labelKey: "eventFront.registrationAction.joinWaitlist",
      enabled: true,
    });
  });

  it("zero wolnych miejsc zamyka zapisy takze wtedy, gdy stan mowi open", () => {
    // Stan i licznik pochodza z tego samego wywolania, ale przy biletach baza
    // NIE liczy wyprzedania na poziomie wydarzenia - licznik jest wtedy jedynym
    // sygnalem.
    expect(surface({ seatsLeft: 0 }).kind).toBe("soldOut");
  });
});

describe("resolveRegistrationSurface: tryb i przeplyw zapisow (ten defekt)", () => {
  it("tryb form kieruje na FORMULARZ, a nie na RPC szybkiego zapisu", () => {
    const result = surface({ registrationMode: "form" });
    expect(result.kind).toBe("registrationForm");
    // Kluczowe: akcja NIE jest `rsvp`. `rsvp_event()` odmawia trybowi `form`
    // statusu `going`, wiec kontrolka z ta akcja prowadzilaby w sciane.
    expect(result.control?.action).toBe("registrationForm");
    expect(result.messageKey).toBe("eventFront.registrationSurface.formRequired");
  });

  it("przeplyw approval kieruje na TEN SAM formularz zgloszenia", () => {
    const result = surface({ registrationFlow: "approval" });
    expect(result.kind).toBe("registrationApproval");
    expect(result.control?.action).toBe("registrationForm");
  });

  it("tryb none nie daje zadnej kontrolki", () => {
    const result = surface({ registrationMode: "none" });
    expect(result.kind).toBe("registrationDisabled");
    expect(result.control).toBeNull();
  });

  it("tryb external prowadzi do adresu organizatora, nie do naszego RPC", () => {
    const result = surface({
      registrationMode: "external",
      registrationState: "registration_external",
      externalRegistrationUrl: "https://rejestracja.example.org/okragly-stol",
    });
    expect(result.kind).toBe("registrationExternal");
    expect(result.control).toEqual({
      action: "external",
      labelKey: "eventFront.registrationAction.registerExternal",
      enabled: true,
      url: "https://rejestracja.example.org/okragly-stol",
    });
  });

  it("tryb external BEZ adresu jest bledem danych, nie stanem zapisow", () => {
    const result = surface({
      registrationMode: "external",
      registrationState: "registration_external",
      externalRegistrationUrl: null,
    });
    expect(result.kind).toBe("registrationExternalMisconfigured");
    expect(result.control).toBeNull();
    expect(result.messageKey).toBe("eventFront.registrationSurface.externalUrlMissing");
  });

  it("adres z samych bialoznakow to brak adresu", () => {
    expect(
      surface({
        registrationMode: "external",
        externalRegistrationUrl: "   ",
      }).kind,
    ).toBe("registrationExternalMisconfigured");
  });

  it("bramka trybu stoi PRZED bramka zalogowania - zalogowanie jej nie zdejmie", () => {
    // Anonim na wydarzeniu bez zapisow ma uslyszec "bez zapisow", a nie
    // "zaloguj sie": zalogowanie nic tam nie zmieni.
    expect(surface({ registrationMode: "none", isSignedIn: false }).kind).toBe(
      "registrationDisabled",
    );
    expect(surface({ registrationMode: "form", isSignedIn: false }).kind).toBe("registrationForm");
    expect(
      surface({
        registrationMode: "external",
        externalRegistrationUrl: "https://example.org/x",
        isSignedIn: false,
      }).kind,
    ).toBe("registrationExternal");
    expect(surface({ registrationFlow: "approval", isSignedIn: false }).kind).toBe(
      "registrationApproval",
    );
  });
});

describe("resolveRegistrationSurface: bramki osobiste", () => {
  it("niezalogowany dostaje zdanie o zalogowaniu, bez kontrolki", () => {
    const result = surface({ isSignedIn: false });
    expect(result.kind).toBe("signInRequired");
    expect(result.control).toBeNull();
    expect(result.messageKey).toBe("eventFront.registrationSurface.signInHint");
  });

  it("zapisy jeszcze nieotwarte nie daja kontrolki", () => {
    const result = surface({ registrationState: "registration_not_open" });
    expect(result.kind).toBe("registrationNotOpen");
    expect(result.control).toBeNull();
  });

  it("prog warstwy prowadzi do czlonkostwa, a nie do zapisu", () => {
    const result = surface({ registrationState: "membership_required", tierLocked: true });
    expect(result.kind).toBe("membershipRequired");
    expect(result.control).toEqual({
      action: "membership",
      labelKey: "eventFront.registrationAction.seeMembership",
      enabled: true,
    });
  });

  it("sam tier_locked wystarczy, gdy stan z bazy mowi open", () => {
    expect(surface({ tierLocked: true }).kind).toBe("membershipRequired");
  });

  it("Chatham House niespelniony ma wlasne zdanie", () => {
    const result = surface({ chathamHouseLocked: true });
    expect(result.kind).toBe("chathamHouseRequired");
    expect(result.messageKey).toBe("eventFront.header.chathamHouseLocked");
    expect(result.control?.action).toBe("membership");
  });
});

describe("resolveRegistrationSurface: wlasny zapis wolajacego", () => {
  it("zapisany sciezka legacy dostaje kontrolke wycofania", () => {
    const result = surface({ myRsvpStatus: "going" });
    expect(result.kind).toBe("registeredRsvp");
    expect(result.messageKey).toBe("eventFront.myRsvp.going");
    expect(result.control).toEqual({
      action: "cancel",
      labelKey: "eventFront.registrationAction.cancel",
      enabled: true,
    });
  });

  it("na liscie rezerwowej legacy niesie pozycje w kolejce", () => {
    const result = surface({ myRsvpStatus: "waitlist", myWaitlistPosition: 4 });
    expect(result.kind).toBe("waitlistedRsvp");
    expect(waitlistPositionOf(result)).toBe(4);
    expect(result.control?.action).toBe("cancel");
  });

  it("nieznana pozycja w kolejce to NULL, nie zero", () => {
    const result = surface({ myRsvpStatus: "waitlist", myWaitlistPosition: null });
    expect(waitlistPositionOf(result)).toBeNull();
  });

  it("zgloszenie etapu 4 NIE MA kontrolki - rsvp_event go nie wycofa", () => {
    // `rsvp_event('cancelled')` tyka wylacznie `event_rsvps`. Przycisk
    // wycofania nad wierszem `event_registrations` bylby cichym brakiem skutku.
    for (const [status, kind] of [
      ["pending", "pendingApproval"],
      ["approved", "registeredApplication"],
      ["rejected", "applicationRejected"],
      ["waitlist", "waitlistedApplication"],
    ] as const) {
      const result = surface({ myRegistrationStatus: status });
      expect(result.kind).toBe(kind);
      expect(result.control).toBeNull();
    }
  });

  it("kolejka etapu 4 niesie pozycje", () => {
    const result = surface({ myRegistrationStatus: "waitlist", myWaitlistPosition: 9 });
    expect(waitlistPositionOf(result)).toBe(9);
  });

  it("zgloszenie etapu 4 wygrywa nad wierszem legacy", () => {
    // Kolejnosc jest swiadoma: sciezka etapu 4 jest docelowa, wiec jej stan
    // opisuje uczestnika dokladniej niz przezytek z legacy RSVP.
    expect(surface({ myRegistrationStatus: "pending", myRsvpStatus: "going" }).kind).toBe(
      "pendingApproval",
    );
  });

  it("interested NIE JEST zapisem - przycisk zapisu zostaje", () => {
    expect(surface({ myRsvpStatus: "interested" }).kind).toBe("open");
  });

  it("cancelled i draft nie blokuja ekranu", () => {
    expect(surface({ myRsvpStatus: "cancelled" }).kind).toBe("open");
    expect(surface({ myRegistrationStatus: "draft" }).kind).toBe("open");
  });

  it("wlasny zapis wygrywa nad KAZDA bramka nizej", () => {
    // Bramka pokazana osobie, ktora jest w srodku, jest falszywa w skutku.
    const result = surface({
      myRsvpStatus: "going",
      tierLocked: true,
      chathamHouseLocked: true,
      registrationState: "sold_out",
      seatsLeft: 0,
      registrationMode: "form",
      registrationFlow: "approval",
    });
    expect(result.kind).toBe("registeredRsvp");
  });
});

describe("resolveRegistrationSurface: fakt o wydarzeniu bije wszystko", () => {
  it("odwolane wydarzenie nie jest wyprzedane ani zapisane", () => {
    const result = surface({
      registrationState: "event_cancelled",
      myRsvpStatus: "going",
      seatsLeft: 0,
      tierLocked: true,
    });
    expect(result.kind).toBe("eventCancelled");
    expect(result.control).toBeNull();
  });

  it("ROZSTRZYGNIECIE: zakonczone wydarzenie wygrywa nad wlasnym zapisem", () => {
    // Wariant zapisanego niesie przycisk wycofania. Wycofanie zapisu
    // z wydarzenia, ktore sie odbylo, jest kontrolka bez skutku.
    const result = surface({
      registrationState: "event_ended",
      hasEnded: true,
      myRsvpStatus: "going",
      myWaitlistPosition: 2,
    });
    expect(result.kind).toBe("eventEnded");
    expect(result.control).toBeNull();
  });

  it("has_ended zamyka ekran takze wtedy, gdy stan z bazy mowi open", () => {
    expect(surface({ hasEnded: true, myRsvpStatus: "going" }).kind).toBe("eventEnded");
  });

  it("zakonczone wygrywa takze nad zgloszeniem etapu 4", () => {
    expect(surface({ hasEnded: true, myRegistrationStatus: "pending" }).kind).toBe("eventEnded");
  });
});

describe("resolveRegistrationSurface: rozstrzygniecie warstwa kontra miejsca", () => {
  it("ROZSTRZYGNIECIE: prog warstwy wygrywa nad brakiem miejsc", () => {
    // Zdanie o warstwie ma wyjscie (cennik). Zdanie o braku miejsc kieruje na
    // liste rezerwowa, ktorej rsvp_event odmowi nie-czlonkowi z tym samym
    // `events: membership required` - czyli dokladnie sciana.
    const result = surface({
      registrationState: "sold_out",
      seatsLeft: 0,
      tierLocked: true,
    });
    expect(result.kind).toBe("membershipRequired");
    expect(result.control?.action).toBe("membership");
  });

  it("warstwa wygrywa nad Chatham House - nazywamy PIERWSZA bramke serwera", () => {
    expect(surface({ tierLocked: true, chathamHouseLocked: true }).kind).toBe("membershipRequired");
  });

  it("okno zapisow wygrywa nad warstwa - idziemy za drabinka naglowka", () => {
    expect(surface({ registrationState: "registration_not_open", tierLocked: true }).kind).toBe(
      "registrationNotOpen",
    );
  });

  it("tryb zapisow wygrywa nad warstwa i nad brakiem miejsc", () => {
    expect(
      surface({
        registrationMode: "form",
        tierLocked: true,
        seatsLeft: 0,
      }).kind,
    ).toBe("registrationForm");
  });
});

describe("isLegacyRsvpDecision", () => {
  it("obejmuje dokladnie cztery warianty sciezki rsvp_event", () => {
    expect(isLegacyRsvpDecision(surface({}))).toBe(true);
    expect(isLegacyRsvpDecision(surface({ seatsLeft: 0 }))).toBe(true);
    expect(isLegacyRsvpDecision(surface({ myRsvpStatus: "going" }))).toBe(true);
    expect(isLegacyRsvpDecision(surface({ myRsvpStatus: "waitlist" }))).toBe(true);
    expect(isLegacyRsvpDecision(surface({ registrationMode: "form" }))).toBe(false);
    expect(isLegacyRsvpDecision(surface({ registrationMode: "none" }))).toBe(false);
    expect(isLegacyRsvpDecision(surface({ tierLocked: true }))).toBe(false);
    expect(isLegacyRsvpDecision(surface({ hasEnded: true }))).toBe(false);
  });
});

describe("canSignalInterest", () => {
  it("przepuszcza tam, gdzie bramka dotyczy tylko statusu going", () => {
    expect(canSignalInterest(surface({ registrationMode: "form" }))).toBe(true);
    expect(canSignalInterest(surface({ registrationMode: "none" }))).toBe(true);
    expect(canSignalInterest(surface({ registrationFlow: "approval" }))).toBe(true);
    expect(canSignalInterest(surface({ seatsLeft: 0 }))).toBe(true);
    expect(canSignalInterest(surface({}))).toBe(true);
  });

  it("zamyka tam, gdzie bramka dotyczy KAZDEGO statusu", () => {
    expect(canSignalInterest(surface({ tierLocked: true }))).toBe(false);
    expect(canSignalInterest(surface({ chathamHouseLocked: true }))).toBe(false);
    expect(canSignalInterest(surface({ registrationState: "registration_not_open" }))).toBe(false);
    expect(canSignalInterest(surface({ isSignedIn: false }))).toBe(false);
    expect(canSignalInterest(surface({ registrationState: "event_cancelled" }))).toBe(false);
    expect(canSignalInterest(surface({ hasEnded: true }))).toBe(false);
    expect(canSignalInterest(surface({ registrationState: "nonsense" }))).toBe(false);
  });
});

describe("rsvpRefusalMessageKey: druga linia obrony", () => {
  it("mapuje cztery odmowy trybu zapisow z 20260823136000", () => {
    expect(rsvpRefusalMessageKey("events: registration disabled")).toBe(
      "eventFront.registrationStateHint.registration_disabled",
    );
    expect(rsvpRefusalMessageKey("events: registration external")).toBe(
      "eventFront.registrationStateHint.registration_external",
    );
    expect(rsvpRefusalMessageKey("events: registration form required")).toBe(
      "eventFront.registrationSurface.formRequired",
    );
    expect(rsvpRefusalMessageKey("events: registration approval required")).toBe(
      "eventFront.registrationSurface.approvalRequired",
    );
  });

  it("Chatham House nie wpada w komunikat o czlonkostwie", () => {
    // `chatham house membership required` ZAWIERA `membership required` - bez
    // kolejnosci dopasowan uczestnik dostawal zdanie o warstwie.
    expect(rsvpRefusalMessageKey("events: chatham house membership required")).toBe(
      "eventFront.header.chathamHouseLocked",
    );
    expect(rsvpRefusalMessageKey("events: membership required")).toBe(
      "eventFront.registrationStateHint.membership_required",
    );
  });

  it("zachowuje trzy stare odmowy i domyka nieznana", () => {
    expect(rsvpRefusalMessageKey("events: full")).toBe("community.events.rsvpFull");
    expect(rsvpRefusalMessageKey("events: rsvp not open")).toBe(
      "community.events.rsvpNotOpenToast",
    );
    expect(rsvpRefusalMessageKey("events: ticket required")).toBe(
      "eventFront.registrationSurface.ticketRequired",
    );
    expect(rsvpRefusalMessageKey("events: not found")).toBe("eventFront.errors.notFound");
    expect(rsvpRefusalMessageKey("events: authentication required")).toBe(
      "eventFront.errors.authRequired",
    );
    expect(rsvpRefusalMessageKey("boom")).toBe("community.events.rsvpError");
  });
});
