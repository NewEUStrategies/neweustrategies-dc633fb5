// Domena katalogu rodzajów wydarzeń - ZAWĘŻANIE, NAZWY I LICZNIKI.
//
// CO TEN PLIK DOWODZI.
//   1. ZBIORY ENUMÓW SĄ KOMPLETNE względem CHECK-ów bazy. Wartość dopuszczona
//      przez bazę i nieobecna w tablicy nie ma etykiety, a `Record<Enum, string>`
//      nie ma nad czym domykać kompletności - i wtedy droplista milczy o wariancie,
//      który baza wpuści.
//   2. ZAWĘŻENIE DEGRADUJE, NIE WYWRACA. `asEvent*` dostaje wartość z kolumny
//      typu `text`; kontrakt publicznej funkcji nie ma zależeć od cudzego CHECK-a
//      (ta sama lekcja co `eventKindLabel` i `Object.hasOwn`).
//   3. KLUCZ TECHNICZNY POWSTAJE Z NAZWY POLSKIEJ, z ROZKŁADEM diakrytyków -
//      „Śniadanie prasowe" musi dać `sniadanie_prasowe`, a nie `niadanie`. To nie
//      kosmetyka: klucz niezgodny z CHECK-iem `event_types_key_format` wraca
//      z bazy jako `23514` bez wskazania pola.
//   4. NAZWA MA TRZYSTOPNIOWY FALLBACK i ostatnim stopniem jest KLUCZ, żeby
//      wiersz bez nazwy nie zniknął z listy.
//   5. LICZNIK UŻYCIA ROZBIJA SIĘ NA SZKICE I OPUBLIKOWANE - bo to dwie różne
//      decyzje redaktora, nie jedna liczba.
import { describe, expect, it } from "vitest";
import {
  EVENT_FORMATS,
  EVENT_FORMAT_LABEL_KEYS,
  EVENT_GUEST_MODES,
  EVENT_GUEST_MODE_LABEL_KEYS,
  EVENT_REGISTRATION_FLOWS,
  EVENT_REGISTRATION_FLOW_LABEL_KEYS,
  EVENT_REGISTRATION_MODES,
  EVENT_REGISTRATION_MODE_LABEL_KEYS,
  asEventFormat,
  asEventGuestMode,
  asEventRegistrationFlow,
  asEventRegistrationMode,
  eventTypeName,
  eventTypeUsage,
  isEventFormat,
  isEventGuestMode,
  isEventRegistrationFlow,
  isEventRegistrationMode,
  isValidEventTypeKey,
  slugifyEventTypeKey,
} from "@/lib/events/eventTypes";

describe("zbiory enumów przepływu wydarzenia", () => {
  it("odwzorowują CHECK-i z migracji 20260823120000 co do wartości", () => {
    // Wartości przepisane Z MIGRACJI, nie z modułu - inaczej test porównywałby
    // moduł ze sobą i przeszedł także po usunięciu wariantu z bazy.
    expect([...EVENT_FORMATS]).toEqual(["onsite", "online", "hybrid"]);
    expect([...EVENT_REGISTRATION_MODES]).toEqual(["rsvp", "form", "external", "none"]);
    expect([...EVENT_REGISTRATION_FLOWS]).toEqual(["instant", "approval"]);
    expect([...EVENT_GUEST_MODES]).toEqual(["hidden", "teaser", "full"]);
  });

  it("każdy wariant ma klucz etykiety i żaden klucz nie wisi bez wariantu", () => {
    const pairs = [
      [EVENT_FORMATS, EVENT_FORMAT_LABEL_KEYS],
      [EVENT_REGISTRATION_MODES, EVENT_REGISTRATION_MODE_LABEL_KEYS],
      [EVENT_REGISTRATION_FLOWS, EVENT_REGISTRATION_FLOW_LABEL_KEYS],
      [EVENT_GUEST_MODES, EVENT_GUEST_MODE_LABEL_KEYS],
    ] as const;
    for (const [values, labels] of pairs) {
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
    }
  });

  it("dozorcy typu przepuszczają wyłącznie wartości ze zbioru", () => {
    expect(isEventFormat("hybrid")).toBe(true);
    expect(isEventFormat("HYBRID")).toBe(false);
    expect(isEventRegistrationMode("external")).toBe(true);
    expect(isEventRegistrationMode("waitlist")).toBe(false);
    expect(isEventRegistrationFlow("approval")).toBe(true);
    expect(isEventRegistrationFlow("moderated")).toBe(false);
    expect(isEventGuestMode("teaser")).toBe(true);
    expect(isEventGuestMode("public")).toBe(false);
  });
});

describe("zawężanie wartości z bazy", () => {
  it("oddaje wartość ze zbioru bez zmiany", () => {
    expect(asEventFormat("online")).toBe("online");
    expect(asEventRegistrationMode("none")).toBe("none");
    expect(asEventRegistrationFlow("approval")).toBe("approval");
    expect(asEventGuestMode("full")).toBe("full");
  });

  it("degraduje do wariantu domyślnego dla pustki, NULL i wartości spoza zbioru", () => {
    for (const value of [null, undefined, "", "zmyslona"] as const) {
      expect(asEventFormat(value)).toBe("onsite");
      expect(asEventRegistrationMode(value)).toBe("rsvp");
      expect(asEventRegistrationFlow(value)).toBe("instant");
      expect(asEventGuestMode(value)).toBe("teaser");
    }
  });

  it("nie sięga po prototyp obiektu - `constructor` to wartość spoza zbioru", () => {
    // Ta sama klasa błędu, którą naprawiał `Object.hasOwn` w `eventKindLabel`:
    // odczyt z gołej mapy trafiał w `Object.prototype` i widział funkcję jako
    // wartość prawdziwą.
    expect(asEventFormat("constructor")).toBe("onsite");
    expect(asEventGuestMode("toString")).toBe("teaser");
  });
});

describe("klucz techniczny rodzaju", () => {
  it("rozkłada polskie diakrytyki, a nie wycina liter", () => {
    expect(slugifyEventTypeKey("Śniadanie prasowe")).toBe("sniadanie_prasowe");
    expect(slugifyEventTypeKey("Wizyta studyjna w Brukseli")).toBe("wizyta_studyjna_w_brukseli");
    expect(slugifyEventTypeKey("Łódzka debata")).toBe("lodzka_debata");
    expect(slugifyEventTypeKey("Żółty Ćwiczenie ąę")).toBe("zolty_cwiczenie_ae");
  });

  it("przycina separatory z brzegów i skleja powtórzenia", () => {
    expect(slugifyEventTypeKey("  --Panel   ekspertów!!  ")).toBe("panel_ekspertow");
    expect(slugifyEventTypeKey("2026 / Q1")).toBe("2026_q1");
  });

  it("mieści się w limicie CHECK-a bazy", () => {
    const long = slugifyEventTypeKey("a".repeat(200));
    expect(long.length).toBeLessThanOrEqual(49);
    expect(isValidEventTypeKey(long)).toBe(true);
  });

  it("odrzuca klucze, których nie wpuści CHECK `event_types_key_format`", () => {
    expect(isValidEventTypeKey("webinar")).toBe(true);
    expect(isValidEventTypeKey("panel_2026")).toBe(true);
    // Musi zaczynać się od litery, więc cyfra i podkreślenie na starcie odpadają.
    expect(isValidEventTypeKey("2026_panel")).toBe(false);
    expect(isValidEventTypeKey("_panel")).toBe(false);
    // Jednoznakowy klucz nie przechodzi - wzorzec wymaga co najmniej dwóch.
    expect(isValidEventTypeKey("a")).toBe(false);
    expect(isValidEventTypeKey("Panel")).toBe(false);
    expect(isValidEventTypeKey("panel-ekspertow")).toBe(false);
    expect(isValidEventTypeKey("a".repeat(50))).toBe(false);
  });
});

describe("nazwa rodzaju w języku interfejsu", () => {
  const row = { key: "roundtable", name_pl: "Okrągły stół", name_en: "Roundtable" };

  it("bierze język zadany", () => {
    expect(eventTypeName(row, "pl")).toBe("Okrągły stół");
    expect(eventTypeName(row, "en")).toBe("Roundtable");
  });

  it("spada na drugi język, gdy zadany jest pusty", () => {
    expect(eventTypeName({ ...row, name_en: "" }, "en")).toBe("Okrągły stół");
    expect(eventTypeName({ ...row, name_pl: "   " }, "pl")).toBe("Roundtable");
  });

  it("ostatnim stopniem jest klucz, żeby wiersz bez nazwy nie zniknął z listy", () => {
    expect(eventTypeName({ key: "roundtable", name_pl: "", name_en: " " }, "pl")).toBe(
      "roundtable",
    );
  });
});

describe("licznik użycia rodzaju", () => {
  it("rozbija sumę na opublikowane i szkice", () => {
    expect(eventTypeUsage({ events_count: 40, published_events_count: 12 })).toEqual({
      total: 40,
      published: 12,
      drafts: 28,
    });
  });

  it("dla rodzaju nieużywanego oddaje trzy zera", () => {
    expect(eventTypeUsage({ events_count: 0, published_events_count: 0 })).toEqual({
      total: 0,
      published: 0,
      drafts: 0,
    });
  });
});
