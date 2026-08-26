// Testy wersji roboczej ekranu „Ustawienia rejestracji" studia wydarzenia.
//
// SPRAWDZAMY REGULY, KTORE STOJA TAKZE W BAZIE - i to w DWOCH warstwach bazy
// naraz. `admin_event_general_save` nazywa czesc odmow po ludzku
// (`invalid_capacity`, `external_url_required`), ale tabela `events` ma wlasne
// CHECK-i, ktore sa OSTRZEJSZE: `capacity > 0` (RPC przepuszcza zero),
// `ticket_price_cents >= 100` (RPC przepuszcza 1 grosz) i `ticket_currency IN
// ('PLN','EUR')` (RPC przepuszcza dowolne trzy litery). Rozjazd w kazdym z tych
// trzech miejsc konczy sie surowym `23514` u redaktora, wiec test zestawia oba
// zbiory regul bez DOM-u i bez bazy.
import { describe, expect, it } from "vitest";
import {
  REGISTRATION_SETTINGS_MAX_URL,
  registrationPriceCents,
  registrationPriceInput,
  registrationSettingsDirty,
  registrationSettingsDraftFromRow,
  registrationSettingsPayload,
  registrationSettingsWarnings,
  validateRegistrationSettingsDraft,
  type RegistrationSettingsDraft,
} from "@/lib/events/registrationSettingsDraft";

const EVENT_ID = "11111111-1111-1111-1111-111111111111";

/** Szkic, ktory przechodzi walidacje - punkt odniesienia dla wszystkich prob. */
const VALID: RegistrationSettingsDraft = {
  registrationMode: "rsvp",
  registrationFlow: "instant",
  externalRegistrationUrl: "",
  visibility: "members",
  minTierRank: "0",
  earlyRsvpRank: "",
  rsvpOpensAt: "",
  chathamHouse: false,
  capacity: "120",
  ticketPrice: "",
  ticketCurrency: "PLN",
  joinUrl: "",
  recordingUrl: "",
};

function draft(patch: Partial<RegistrationSettingsDraft>): RegistrationSettingsDraft {
  return { ...VALID, ...patch };
}

function fields(patch: Partial<RegistrationSettingsDraft>): string[] {
  return validateRegistrationSettingsDraft(draft(patch)).map((error) => error.field);
}

function keys(patch: Partial<RegistrationSettingsDraft>): string[] {
  return validateRegistrationSettingsDraft(draft(patch)).map((error) => error.messageKey);
}

describe("walidacja ustawien rejestracji", () => {
  it("poprawny szkic nie zglasza zadnego bledu", () => {
    expect(validateRegistrationSettingsDraft(VALID)).toEqual([]);
  });

  it("wymaga adresu zewnetrznego DOKLADNIE dla trybu external", () => {
    expect(fields({ registrationMode: "external" })).toEqual(["externalRegistrationUrl"]);
    expect(keys({ registrationMode: "external" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.externalUrlRequired",
    ]);
    expect(fields({ registrationMode: "external", externalRegistrationUrl: "   " })).toEqual([
      "externalRegistrationUrl",
    ]);
    // Pozostale trzy tryby nie potrzebuja adresu i nie wolno im go wymuszac.
    for (const mode of ["rsvp", "form", "none"] as const) {
      expect(fields({ registrationMode: mode })).toEqual([]);
    }
    expect(
      fields({
        registrationMode: "external",
        externalRegistrationUrl: "https://zapisy.example.org",
      }),
    ).toEqual([]);
  });

  it("sprawdza ksztalt adresu zewnetrznego W KAZDYM trybie, nie tylko w external", () => {
    // RPC patrzy na ksztalt tylko dla trybu `external`, ale CHECK
    // `events_external_registration_url_https` obowiazuje zawsze - adres http
    // wklejony „na probe" przy trybie rsvp wywalilby sie na tabeli.
    expect(fields({ externalRegistrationUrl: "http://zapisy.example.org" })).toEqual([
      "externalRegistrationUrl",
    ]);
    expect(keys({ externalRegistrationUrl: "zapisy.example.org" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.externalUrlInvalid",
    ]);
    expect(fields({ externalRegistrationUrl: "https://zapisy.example.org/a b" })).toEqual([
      "externalRegistrationUrl",
    ]);
  });

  it("odrzuca adres zewnetrzny dluzszy niz limit kolumny", () => {
    const long = `https://example.org/${"a".repeat(REGISTRATION_SETTINGS_MAX_URL)}`;
    expect(keys({ externalRegistrationUrl: long })).toEqual([
      "adminEvents.studio.registrationSettings.errors.externalUrlTooLong",
    ]);
    const exact = `https://e.org/${"a".repeat(REGISTRATION_SETTINGS_MAX_URL - 14)}`;
    expect(exact).toHaveLength(REGISTRATION_SETTINGS_MAX_URL);
    expect(fields({ externalRegistrationUrl: exact })).toEqual([]);
  });

  it("nie przepuszcza LIMITU MIEJSC rownego zeru - CHECK bazy wymaga wiecej", () => {
    // To jest ta regula, ktora RPC przepuszcza (`capacity < 0`), a tabela
    // odrzuca (`capacity IS NULL OR capacity > 0`). Zero miejsc nie jest
    // limitem, jest wydarzeniem zamknietym - na to jest tryb „bez zapisow".
    expect(keys({ capacity: "0" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.capacityInvalid",
    ]);
    expect(fields({ capacity: "-1" })).toEqual(["capacity"]);
    expect(fields({ capacity: "1" })).toEqual([]);
  });

  it("puste pole limitu miejsc znaczy „bez limitu”, a nie blad", () => {
    expect(fields({ capacity: "" })).toEqual([]);
    expect(fields({ capacity: "   " })).toEqual([]);
  });

  it("odrzuca limit miejsc, ktory nie jest liczba calkowita", () => {
    expect(fields({ capacity: "sto" })).toEqual(["capacity"]);
    expect(fields({ capacity: "12,5" })).toEqual(["capacity"]);
    expect(fields({ capacity: "12.5" })).toEqual(["capacity"]);
  });

  it("nie przepuszcza ujemnej rangi warstwy w zadnym z dwoch pol", () => {
    expect(keys({ minTierRank: "-1" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.tierRankInvalid",
    ]);
    expect(fields({ earlyRsvpRank: "-3" })).toEqual(["earlyRsvpRank"]);
    expect(fields({ minTierRank: "-1", earlyRsvpRank: "-1" })).toEqual([
      "minTierRank",
      "earlyRsvpRank",
    ]);
    expect(fields({ minTierRank: "0", earlyRsvpRank: "0" })).toEqual([]);
  });

  it("przyjmuje pusty prog warstwy (RPC czyta go jako zero) i puste pierwszenstwo", () => {
    expect(fields({ minTierRank: "" })).toEqual([]);
    expect(fields({ earlyRsvpRank: "" })).toEqual([]);
  });

  it("odrzuca range warstwy, ktora nie jest liczba", () => {
    expect(fields({ minTierRank: "czlonek" })).toEqual(["minTierRank"]);
    expect(fields({ earlyRsvpRank: "10+" })).toEqual(["earlyRsvpRank"]);
  });

  it("nie przepuszcza ceny nizszej niz 1,00 - CHECK bazy wymaga stu groszy", () => {
    // RPC pilnuje `>= 0`, `events_ticket_price_positive` wymaga `>= 100`.
    expect(keys({ ticketPrice: "0" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.priceTooLow",
    ]);
    expect(fields({ ticketPrice: "0,99" })).toEqual(["ticketPrice"]);
    expect(fields({ ticketPrice: "1,00" })).toEqual([]);
    expect(fields({ ticketPrice: "1" })).toEqual([]);
  });

  it("puste pole ceny znaczy „wydarzenie bezplatne”, a nie zero", () => {
    expect(fields({ ticketPrice: "" })).toEqual([]);
    expect(fields({ ticketPrice: "  " })).toEqual([]);
  });

  it("odrzuca kwote, ktorej nie da sie przeliczyc na grosze", () => {
    expect(keys({ ticketPrice: "za darmo" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.priceInvalid",
    ]);
    expect(fields({ ticketPrice: "250.555" })).toEqual(["ticketPrice"]);
    expect(fields({ ticketPrice: "-250" })).toEqual(["ticketPrice"]);
    expect(fields({ ticketPrice: "250,00 zl" })).toEqual(["ticketPrice"]);
  });

  it("wymaga https dla adresu transmisji i nagrania - http to mieszana tresc", () => {
    expect(keys({ joinUrl: "http://stream.example.org" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.joinUrlInvalid",
    ]);
    expect(keys({ recordingUrl: "http://vod.example.org" })).toEqual([
      "adminEvents.studio.registrationSettings.errors.recordingUrlInvalid",
    ]);
    expect(fields({ joinUrl: "stream.example.org" })).toEqual(["joinUrl"]);
    expect(
      fields({ joinUrl: "https://stream.example.org", recordingUrl: "https://vod.example.org" }),
    ).toEqual([]);
  });

  it("puste pola transmisji i nagrania sa poprawnym stanem", () => {
    expect(fields({ joinUrl: "", recordingUrl: "   " })).toEqual([]);
  });

  it("odrzuca adres transmisji dluzszy niz limit RPC", () => {
    const long = `https://example.org/${"a".repeat(REGISTRATION_SETTINGS_MAX_URL)}`;
    expect(fields({ joinUrl: long })).toEqual(["joinUrl"]);
    expect(fields({ recordingUrl: long })).toEqual(["recordingUrl"]);
  });

  it("zwraca bledy w kolejnosci CZYTANIA ekranu", () => {
    // Kolejnosc nie jest kosmetyka: ekran podswietla pierwszy blad z listy.
    expect(
      fields({
        registrationMode: "external",
        capacity: "0",
        ticketPrice: "0",
        joinUrl: "http://a.example",
        recordingUrl: "http://b.example",
        minTierRank: "-1",
      }),
    ).toEqual([
      "externalRegistrationUrl",
      "minTierRank",
      "capacity",
      "ticketPrice",
      "joinUrl",
      "recordingUrl",
    ]);
  });
});

describe("ostrzezenia ustawien rejestracji", () => {
  it("poprawny szkic nie zglasza ostrzezen", () => {
    expect(registrationSettingsWarnings(VALID, "onsite")).toEqual([]);
  });

  it("mowi o wydarzeniu online, ktore zbiera zapisy bez adresu transmisji", () => {
    for (const mode of ["rsvp", "form"] as const) {
      expect(registrationSettingsWarnings(draft({ registrationMode: mode }), "online")).toContain(
        "adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl",
      );
    }
    // Adres jest - nie ma o czym ostrzegac.
    expect(
      registrationSettingsWarnings(draft({ joinUrl: "https://stream.example.org" }), "online"),
    ).not.toContain("adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl");
    // Format stacjonarny nie potrzebuje transmisji.
    expect(registrationSettingsWarnings(VALID, "onsite")).not.toContain(
      "adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl",
    );
    // Tryby, ktore u nas nie zbieraja zapisow, nie obiecuja transmisji.
    for (const mode of ["external", "none"] as const) {
      expect(
        registrationSettingsWarnings(
          draft({ registrationMode: mode, externalRegistrationUrl: "https://z.example.org" }),
          "online",
        ),
      ).not.toContain("adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl");
    }
  });

  it("mowi o pierwszenstwie warstwy bez daty otwarcia zapisow", () => {
    expect(registrationSettingsWarnings(draft({ earlyRsvpRank: "10" }), "onsite")).toContain(
      "adminEvents.studio.registrationSettings.warnings.earlyRankWithoutOpening",
    );
    expect(
      registrationSettingsWarnings(
        draft({ earlyRsvpRank: "10", rsvpOpensAt: "2026-09-01T08:00:00.000Z" }),
        "onsite",
      ),
    ).not.toContain("adminEvents.studio.registrationSettings.warnings.earlyRankWithoutOpening");
    expect(
      registrationSettingsWarnings(draft({ rsvpOpensAt: "2026-09-01T08:00:00.000Z" }), "onsite"),
    ).not.toContain("adminEvents.studio.registrationSettings.warnings.earlyRankWithoutOpening");
  });

  it("mowi o cenie przy trybie „bez zapisow” - nie ma jak jej zaplacic", () => {
    expect(
      registrationSettingsWarnings(
        draft({ registrationMode: "none", ticketPrice: "250,00" }),
        "onsite",
      ),
    ).toContain("adminEvents.studio.registrationSettings.warnings.pricedWithoutRegistration");
    expect(registrationSettingsWarnings(draft({ ticketPrice: "250,00" }), "onsite")).not.toContain(
      "adminEvents.studio.registrationSettings.warnings.pricedWithoutRegistration",
    );
    expect(
      registrationSettingsWarnings(draft({ registrationMode: "none" }), "onsite"),
    ).not.toContain("adminEvents.studio.registrationSettings.warnings.pricedWithoutRegistration");
  });

  it("mowi o zasadzie Chatham House na stronie PUBLICZNEJ", () => {
    expect(
      registrationSettingsWarnings(draft({ chathamHouse: true, visibility: "public" }), "onsite"),
    ).toContain("adminEvents.studio.registrationSettings.warnings.chathamHouseOnPublicPage");
    expect(
      registrationSettingsWarnings(draft({ chathamHouse: true, visibility: "members" }), "onsite"),
    ).not.toContain("adminEvents.studio.registrationSettings.warnings.chathamHouseOnPublicPage");
    expect(registrationSettingsWarnings(draft({ visibility: "public" }), "onsite")).not.toContain(
      "adminEvents.studio.registrationSettings.warnings.chathamHouseOnPublicPage",
    );
  });

  it("zbiera kilka ostrzezen naraz", () => {
    expect(
      registrationSettingsWarnings(
        draft({
          registrationMode: "form",
          earlyRsvpRank: "10",
          chathamHouse: true,
          visibility: "public",
        }),
        "online",
      ),
    ).toEqual([
      "adminEvents.studio.registrationSettings.warnings.onlineWithoutJoinUrl",
      "adminEvents.studio.registrationSettings.warnings.earlyRankWithoutOpening",
      "adminEvents.studio.registrationSettings.warnings.chathamHouseOnPublicPage",
    ]);
  });
});

describe("przeliczanie ceny miedzy groszami i jednostkami glownymi", () => {
  it("grosze -> pole zawsze z dwoma miejscami po separatorze", () => {
    expect(registrationPriceInput(25_000)).toBe("250.00");
    expect(registrationPriceInput(100)).toBe("1.00");
    expect(registrationPriceInput(105)).toBe("1.05");
    expect(registrationPriceInput(0)).toBe("0.00");
  });

  it("pole -> grosze, z przecinkiem i z kropka jako separatorem", () => {
    expect(registrationPriceCents("250,00")).toBe(25_000);
    expect(registrationPriceCents("250.00")).toBe(25_000);
    expect(registrationPriceCents("250")).toBe(25_000);
    expect(registrationPriceCents("250,5")).toBe(25_050);
    // Arytmetyka na napisach: `250.55 * 100` daje w JS 25055.000000000004.
    expect(registrationPriceCents("250,55")).toBe(25_055);
  });

  it("znosi odstepy z kwoty wklejonej z faktury", () => {
    expect(registrationPriceCents("1 250,00")).toBe(125_000);
    // Spacja NIEROZDZIELAJACA (U+00A0) - tak separator tysiecy wkleja sie
    // z arkusza i z edytora tekstu, a `\s` w JS obejmuje takze ten znak.
    expect(registrationPriceCents("1\u00a0250,00")).toBe(125_000);
    expect(registrationPriceCents("  250,00  ")).toBe(25_000);
  });

  it("puste pole to null, a nie zero - to dwa rozne stany wydarzenia", () => {
    expect(registrationPriceCents("")).toBeNull();
    expect(registrationPriceCents("   ")).toBeNull();
    expect(registrationPriceCents("0")).toBe(0);
  });

  it("kwota nieczytelna wraca jako NaN, a nie jako zero", () => {
    expect(registrationPriceCents("za darmo")).toBeNaN();
    expect(registrationPriceCents("250,555")).toBeNaN();
    expect(registrationPriceCents("-250")).toBeNaN();
    expect(registrationPriceCents("250,00 PLN")).toBeNaN();
  });

  it("droga w obie strony nie gubi groszy", () => {
    for (const cents of [100, 105, 999, 25_000, 125_055]) {
      expect(registrationPriceCents(registrationPriceInput(cents))).toBe(cents);
    }
  });
});

describe("szkic z wiersza RPC", () => {
  it("czyta komplet pol ekranu", () => {
    expect(
      registrationSettingsDraftFromRow({
        registration_mode: "form",
        registration_flow: "approval",
        external_registration_url: "https://zapisy.example.org",
        visibility: "public",
        min_tier_rank: 10,
        early_rsvp_rank: 20,
        rsvp_opens_at: "2026-09-01T08:00:00.000Z",
        chatham_house: true,
        capacity: 120,
        ticket_price_cents: 25_000,
        ticket_currency: "EUR",
        join_url: "https://stream.example.org",
        recording_url: "https://vod.example.org",
      }),
    ).toEqual({
      registrationMode: "form",
      registrationFlow: "approval",
      externalRegistrationUrl: "https://zapisy.example.org",
      visibility: "public",
      minTierRank: "10",
      earlyRsvpRank: "20",
      rsvpOpensAt: "2026-09-01T08:00:00.000Z",
      chathamHouse: true,
      capacity: "120",
      ticketPrice: "250.00",
      ticketCurrency: "EUR",
      joinUrl: "https://stream.example.org",
      recordingUrl: "https://vod.example.org",
    });
  });

  it("kolumny NULL-owalne daja PUSTE pola, a nie zera", () => {
    // `capacity`, `early_rsvp_rank` i `ticket_price_cents` sa NULL-owalne, choc
    // generator typow oddaje je jako `number`. Zero znaczy tu co innego niz brak.
    const from = registrationSettingsDraftFromRow({
      capacity: null,
      early_rsvp_rank: null,
      ticket_price_cents: null,
      rsvp_opens_at: null,
      join_url: null,
      recording_url: null,
      external_registration_url: null,
    });
    expect(from.capacity).toBe("");
    expect(from.earlyRsvpRank).toBe("");
    expect(from.ticketPrice).toBe("");
    expect(from.rsvpOpensAt).toBe("");
    expect(from.joinUrl).toBe("");
    expect(from.recordingUrl).toBe("");
    expect(from.externalRegistrationUrl).toBe("");
  });

  it("cena zero z bazy zostaje polem „0.00”, zeby zapis jej nie przepisywal na NULL", () => {
    expect(registrationSettingsDraftFromRow({ ticket_price_cents: 0 }).ticketPrice).toBe("0.00");
  });

  it("normalizuje wielkosc liter w walucie i degraduje waluty spoza CHECK-a", () => {
    expect(registrationSettingsDraftFromRow({ ticket_currency: "eur" }).ticketCurrency).toBe("EUR");
    expect(registrationSettingsDraftFromRow({ ticket_currency: " pln " }).ticketCurrency).toBe(
      "PLN",
    );
    // `events_ticket_currency_allowed` zna dwie waluty - trzecia jest bledem danych.
    expect(registrationSettingsDraftFromRow({ ticket_currency: "USD" }).ticketCurrency).toBe("PLN");
    expect(registrationSettingsDraftFromRow({}).ticketCurrency).toBe("PLN");
  });

  it("widocznosc poza zbiorem degraduje do WEZSZEJ z dwoch", () => {
    // Kierunek degradacji jest swiadomy: uszkodzona wartosc ma zamknac
    // wydarzenie dla czlonkow, a nie otworzyc je publicznie.
    expect(registrationSettingsDraftFromRow({ visibility: "public" }).visibility).toBe("public");
    expect(registrationSettingsDraftFromRow({ visibility: "members" }).visibility).toBe("members");
    expect(registrationSettingsDraftFromRow({ visibility: "world" }).visibility).toBe("members");
    expect(registrationSettingsDraftFromRow({}).visibility).toBe("members");
  });

  it("tryb i przebieg poza zbiorem degraduja do wartosci domyslnych kolumn", () => {
    const from = registrationSettingsDraftFromRow({
      registration_mode: "carrier-pigeon",
      registration_flow: "someday",
    });
    expect(from.registrationMode).toBe("rsvp");
    expect(from.registrationFlow).toBe("instant");
  });

  it("zasada Chatham House jest wlaczona TYLKO przy jawnym true", () => {
    expect(registrationSettingsDraftFromRow({ chatham_house: true }).chathamHouse).toBe(true);
    expect(registrationSettingsDraftFromRow({ chatham_house: false }).chathamHouse).toBe(false);
    expect(registrationSettingsDraftFromRow({ chatham_house: "true" }).chathamHouse).toBe(false);
    expect(registrationSettingsDraftFromRow({}).chathamHouse).toBe(false);
  });
});

describe("payload dla admin_event_general_save", () => {
  it("wysyla WYLACZNIE pola tego ekranu plus identyfikator", () => {
    // To jest sedno wspolzycia dwoch ekranow na jednej tabeli: klucz nieobecny
    // w payloadzie znaczy „pole nietkniete", wiec tytul, slug i termin zostaja
    // takie, jakie zapisal ekran „Informacje ogolne".
    expect(Object.keys(registrationSettingsPayload(EVENT_ID, VALID)).sort()).toEqual([
      "capacity",
      "chatham_house",
      "early_rsvp_rank",
      "external_registration_url",
      "id",
      "join_url",
      "min_tier_rank",
      "recording_url",
      "registration_flow",
      "registration_mode",
      "rsvp_opens_at",
      "ticket_currency",
      "ticket_price_cents",
      "visibility",
    ]);
  });

  it("przeklada komplet pol na klucze RPC", () => {
    expect(
      registrationSettingsPayload(
        EVENT_ID,
        draft({
          registrationMode: "external",
          registrationFlow: "approval",
          externalRegistrationUrl: "  https://zapisy.example.org  ",
          visibility: "public",
          minTierRank: " 10 ",
          earlyRsvpRank: " 20 ",
          rsvpOpensAt: " 2026-09-01T08:00:00.000Z ",
          chathamHouse: true,
          capacity: " 120 ",
          ticketPrice: "1 250,55",
          ticketCurrency: "EUR",
          joinUrl: " https://stream.example.org ",
          recordingUrl: " https://vod.example.org ",
        }),
      ),
    ).toEqual({
      id: EVENT_ID,
      registration_mode: "external",
      registration_flow: "approval",
      external_registration_url: "https://zapisy.example.org",
      visibility: "public",
      capacity: "120",
      min_tier_rank: "10",
      early_rsvp_rank: "20",
      rsvp_opens_at: "2026-09-01T08:00:00.000Z",
      ticket_price_cents: "125055",
      ticket_currency: "EUR",
      chatham_house: "true",
      join_url: "https://stream.example.org",
      recording_url: "https://vod.example.org",
    });
  });

  it("puste pola ida PUSTYM napisem - RPC czyta go jako NULL", () => {
    const payload = registrationSettingsPayload(EVENT_ID, VALID);
    expect(payload.external_registration_url).toBe("");
    expect(payload.early_rsvp_rank).toBe("");
    expect(payload.rsvp_opens_at).toBe("");
    expect(payload.ticket_price_cents).toBe("");
    expect(payload.join_url).toBe("");
    expect(payload.recording_url).toBe("");
  });

  it("cena idzie w GROSZACH, nie w jednostkach glownych", () => {
    expect(registrationSettingsPayload(EVENT_ID, draft({ ticketPrice: "250,00" }))).toMatchObject({
      ticket_price_cents: "25000",
    });
    expect(registrationSettingsPayload(EVENT_ID, draft({ ticketPrice: "1,05" }))).toMatchObject({
      ticket_price_cents: "105",
    });
  });

  it("waluta idzie WIELKIMI literami - CHECK bazy porownuje do PLN i EUR", () => {
    // Wiersz z baza zapisana malymi literami jest normalizowany juz w szkicu,
    // wiec payload nie ma jak wyslac „eur".
    const from = registrationSettingsDraftFromRow({ ticket_currency: "eur" });
    expect(registrationSettingsPayload(EVENT_ID, from)).toMatchObject({ ticket_currency: "EUR" });
  });

  it("zasada Chatham House idzie napisem czytanym przez ::boolean", () => {
    expect(registrationSettingsPayload(EVENT_ID, draft({ chathamHouse: true }))).toMatchObject({
      chatham_house: "true",
    });
    expect(registrationSettingsPayload(EVENT_ID, draft({ chathamHouse: false }))).toMatchObject({
      chatham_house: "false",
    });
  });

  it("kwota nieczytelna nie wychodzi z modulu jako NaN", () => {
    // Zapis jest odcinany wczesniej przez walidacje; gdyby jednak tu dotarl,
    // pusty napis jest bezpieczniejszy niz „NaN" wyslane do ::integer.
    expect(registrationSettingsPayload(EVENT_ID, draft({ ticketPrice: "za darmo" }))).toMatchObject(
      { ticket_price_cents: "" },
    );
  });
});

describe("wykrywanie zmiany wersji roboczej", () => {
  it("ten sam szkic nie jest zmieniony", () => {
    expect(registrationSettingsDirty(VALID, VALID)).toBe(false);
  });

  it("dwa zapisy tej samej kwoty to NIE zmiana", () => {
    // „250,00", „250.00" i „250" znacza te same 25000 groszy - pasek zapisu nie
    // ma sie pokazywac po zamianie separatora.
    expect(
      registrationSettingsDirty(draft({ ticketPrice: "250,00" }), draft({ ticketPrice: "250.00" })),
    ).toBe(false);
    expect(
      registrationSettingsDirty(draft({ ticketPrice: "250" }), draft({ ticketPrice: "250,00" })),
    ).toBe(false);
  });

  it("odstepy wokol wartosci to NIE zmiana", () => {
    expect(registrationSettingsDirty(draft({ capacity: " 120 " }), VALID)).toBe(false);
    expect(registrationSettingsDirty(draft({ joinUrl: "   " }), VALID)).toBe(false);
  });

  it("kazde pole ekranu wlacza pasek zapisu", () => {
    const changes: Partial<RegistrationSettingsDraft>[] = [
      { registrationMode: "form" },
      { registrationFlow: "approval" },
      { externalRegistrationUrl: "https://zapisy.example.org" },
      { visibility: "public" },
      { minTierRank: "10" },
      { earlyRsvpRank: "20" },
      { rsvpOpensAt: "2026-09-01T08:00:00.000Z" },
      { chathamHouse: true },
      { capacity: "121" },
      { ticketPrice: "250,00" },
      { ticketCurrency: "EUR" },
      { joinUrl: "https://stream.example.org" },
      { recordingUrl: "https://vod.example.org" },
    ];
    for (const patch of changes) {
      expect(registrationSettingsDirty(draft(patch), VALID), Object.keys(patch)[0]).toBe(true);
    }
  });

  it("brak ceny i cena zerowa to DWIE rozne wartosci", () => {
    // „bezplatne" (NULL) i „0,00" to dwa rozne wiersze bazy, wiec przejscie
    // miedzy nimi musi wlaczyc pasek zapisu.
    expect(registrationSettingsDirty(draft({ ticketPrice: "0" }), draft({ ticketPrice: "" }))).toBe(
      true,
    );
  });
});
