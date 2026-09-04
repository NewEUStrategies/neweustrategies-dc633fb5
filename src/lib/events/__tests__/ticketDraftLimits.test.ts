// Szkic biletu - GRANICE, ktorych pilnuje CHECK w bazie, i CENA.
//
// PO CO TEN PLIK OBOK `ticketDraft.test.ts` i `ticketPricingDraft.test.ts`.
// Tamte opisuja konwersje i cennik fazowy. Tutaj stoja warunki DLUGOSCI i
// KWOTY, czyli te, ktorych zlamanie wraca z bazy jako `23514` BEZ NAZWY POLA:
// redaktor widzi „cos poszlo nie tak" i ani jednego podswietlonego pola, wiec
// zapisuje bilet po omacku albo rezygnuje. Kazdy warunek, ktory baza sprawdza,
// ma tu miec odpowiednik z polem i kluczem komunikatu - i to jest jedyny powod,
// dla ktorego `ticketDraftIssue` w ogole istnieje.
//
// CENA JEST W GROSZACH. `price_cents: 1999` to 19,99 w kasie. Pomylka o rzad
// wielkosci w tym miejscu obciaza karte uczestnika dziesieciokrotnie, wiec sufit
// i podloga ceny maja tu asercje na wartosciach granicznych, a nie „gdzies duzo".
import { describe, expect, it } from "vitest";
import {
  TICKET_ACCESS_CODE_MAX,
  TICKET_CURRENCIES,
  TICKET_MAX_ACCESS_CODE_HINT,
  TICKET_MAX_BENEFIT_LENGTH,
  TICKET_MAX_DESCRIPTION,
  TICKET_MAX_NAME,
  TICKET_MAX_PHASES,
  TICKET_MAX_PRICE_CENTS,
  TICKET_MAX_QUOTA,
  emptyTicketDraft,
  emptyTicketPhase,
  fromLocalInput,
  phasesFromJson,
  ticketDraftFromRow,
  ticketDraftIssue,
  ticketDraftToInput,
  type TicketDraft,
  type TicketPhaseDraft,
} from "@/lib/events/ticketDraft";
import { eventTicketRow } from "@/test/events/adminSalesRows";

const EVENT_ID = "11111111-1111-4111-8111-111111111111";

function valid(overrides: Partial<TicketDraft> = {}): TicketDraft {
  return {
    ...emptyTicketDraft(10),
    key: "vip_pass",
    namePl: "Karnet VIP",
    nameEn: "VIP pass",
    priceCents: "15000",
    ...overrides,
  };
}

function znaki(count: number): string {
  return "x".repeat(count);
}

describe("dlugosci tekstow maja odpowiednik przy polu, a nie odmowe bez nazwy", () => {
  it("nazwa dluzsza niz limit bazy wskazuje TEN jezyk, ktory jest za dlugi", () => {
    // Dwa jezyki, dwa osobne pola: wskazanie „nazwa" bez jezyka kaze redaktorowi
    // liczyc znaki w obu.
    expect(ticketDraftIssue(valid({ namePl: znaki(TICKET_MAX_NAME + 1) }))).toEqual({
      field: "namePl",
      errorKey: "invalidNames",
    });
    expect(ticketDraftIssue(valid({ nameEn: znaki(TICKET_MAX_NAME + 1) }))).toEqual({
      field: "nameEn",
      errorKey: "invalidNames",
    });
  });

  it("nazwa dokladnie na limicie przechodzi - granica jest wlaczna", () => {
    // Odciecie o jeden znak za wczesnie blokuje poprawny tytul i nie da sie
    // tego odroznic od awarii zapisu.
    expect(
      ticketDraftIssue(valid({ namePl: znaki(TICKET_MAX_NAME), nameEn: znaki(TICKET_MAX_NAME) })),
    ).toBeNull();
  });

  it("opis dluzszy niz limit bazy wskazuje TEN jezyk, ktory jest za dlugi", () => {
    expect(ticketDraftIssue(valid({ descriptionPl: znaki(TICKET_MAX_DESCRIPTION + 1) }))).toEqual({
      field: "descriptionPl",
      errorKey: "invalidRequest",
    });
    expect(ticketDraftIssue(valid({ descriptionEn: znaki(TICKET_MAX_DESCRIPTION + 1) }))).toEqual({
      field: "descriptionEn",
      errorKey: "invalidRequest",
    });
    expect(ticketDraftIssue(valid({ descriptionPl: znaki(TICKET_MAX_DESCRIPTION) }))).toBeNull();
  });

  it("podpowiedz do kodu dostepu ma wlasny limit, oddzielny od samego kodu", () => {
    // Podpowiedz jest publiczna („kod znajdziesz w zaproszeniu"), a kod nie -
    // sklejenie limitow kasowaloby te roznice.
    expect(
      ticketDraftIssue(valid({ accessCodeHint: znaki(TICKET_MAX_ACCESS_CODE_HINT + 1) })),
    ).toEqual({ field: "accessCodeHint", errorKey: "invalidRequest" });
    expect(
      ticketDraftIssue(valid({ accessCodeHint: znaki(TICKET_MAX_ACCESS_CODE_HINT) })),
    ).toBeNull();
    // Klucz komunikatu decyduje o TRESCI zdania przy polu - „za dlugi kod"
    // i „bledne zadanie" to dwie rozne instrukcje dla redaktora.
    expect(ticketDraftIssue(valid({ accessCode: znaki(TICKET_ACCESS_CODE_MAX + 1) }))).toEqual({
      field: "accessCode",
      errorKey: "invalidAccessCode",
    });
  });

  it("pojedyncza korzysc za dluga blokuje zapis, choc lista miesci sie w limicie", () => {
    // Limit dotyczy KAZDEJ linii osobno. Bez tej reguly redaktor wkleja akapit
    // jako „korzysc" i dostaje odmowe bazy bez wskazania, ktora linia zawinila.
    const zaDluga = `Normalna korzysc\n${znaki(TICKET_MAX_BENEFIT_LENGTH + 1)}`;
    expect(ticketDraftIssue(valid({ benefitsPl: zaDluga }))).toEqual({
      field: "benefitsPl",
      errorKey: "invalidBenefits",
    });
    expect(ticketDraftIssue(valid({ benefitsEn: zaDluga }))).toEqual({
      field: "benefitsEn",
      errorKey: "invalidBenefits",
    });
    expect(ticketDraftIssue(valid({ benefitsPl: znaki(TICKET_MAX_BENEFIT_LENGTH) }))).toBeNull();
  });

  it("cennik dluzszy niz limit odpada w calosci, nie po jednym progu", () => {
    const faza = (): TicketPhaseDraft => ({ ...emptyTicketPhase(), priceCents: "10000" });
    const zaDuzo = Array.from({ length: TICKET_MAX_PHASES + 1 }, faza);
    expect(ticketDraftIssue(valid({ phases: zaDuzo }))).toEqual({
      field: "phases",
      errorKey: "invalidPriceSchedule",
    });
    expect(
      ticketDraftIssue(valid({ phases: Array.from({ length: TICKET_MAX_PHASES }, faza) })),
    ).toBeNull();
  });
});

describe("cena i pula - kwoty, ktore obciazaja karte uczestnika", () => {
  it("cena na suficie przechodzi, o grosz wyzej nie", () => {
    // Sufit to 100 000,00 w groszach. Wyzej to literowka (dodane zero), a
    // literowka w cenie jest widoczna dopiero na wyciagu uczestnika.
    expect(ticketDraftIssue(valid({ priceCents: String(TICKET_MAX_PRICE_CENTS) }))).toBeNull();
    expect(ticketDraftIssue(valid({ priceCents: String(TICKET_MAX_PRICE_CENTS + 1) }))).toEqual({
      field: "priceCents",
      errorKey: "invalidRequest",
    });
  });

  it("cena zero jest legalna (bilet bezplatny), cena ujemna nie", () => {
    // Bilet za zero zloty to wstep wolny, a nie blad; cena ujemna to przelew
    // do uczestnika.
    expect(ticketDraftIssue(valid({ priceCents: "0" }))).toBeNull();
    expect(ticketDraftIssue(valid({ priceCents: "-1" }))).toEqual({
      field: "priceCents",
      errorKey: "invalidRequest",
    });
  });

  it("pula na suficie przechodzi, o miejsce wyzej nie", () => {
    expect(ticketDraftIssue(valid({ quota: String(TICKET_MAX_QUOTA) }))).toBeNull();
    expect(ticketDraftIssue(valid({ quota: String(TICKET_MAX_QUOTA + 1) }))).toEqual({
      field: "quota",
      errorKey: "invalidRequest",
    });
  });

  it("cena promocyjna nie moze byc wyzsza od bazowej", () => {
    // „Promocja" drozsza od ceny regularnej to zarzut wprowadzania w blad,
    // a nie usterka formularza.
    const drozsza = valid({
      priceCents: "15000",
      earlyBirdPriceCents: "15001",
      earlyBirdUntil: "2026-09-01T10:00",
    });
    expect(ticketDraftIssue(drozsza)).toEqual({
      field: "earlyBirdPriceCents",
      errorKey: "invalidEarlyBird",
    });
    expect(ticketDraftIssue({ ...drozsza, earlyBirdPriceCents: "15000" })).toBeNull();
  });

  // DEFEKT ZAREJESTROWANY, NIE NAPRAWIONY (`it.fails`).
  //
  // `intOrNull("abc")` oddaje `NaN`, a `NaN !== null`, wiec warunek „cena
  // promocyjna bez terminu" zapala sie na CENIE, ktora nie jest liczba, i
  // podswietla POLE TERMINU. Redaktor, ktory wpisal w cene promocyjna „199,00"
  // albo „199 zl", dostaje blad przy dacie: uzupelnia date, zapisuje ponownie
  // i dopiero wtedy dowiaduje sie o cenie. Dwa obiegi formularza zamiast
  // jednego, i przez pierwszy z nich komunikat mowi nieprawde o tym, co jest
  // zle. Kolejnosc warunkow ma najpierw rozstrzygac SKLADNIE liczby, a dopiero
  // potem niepodzielnosc pary. Poprawka nalezy do produkcji, nie do testu.
  it.fails("DEFEKT: cena promocyjna nie bedaca liczba podswietla pole TERMINU", () => {
    const issue = ticketDraftIssue(valid({ earlyBirdPriceCents: "199,00", earlyBirdUntil: "" }));
    expect(issue?.field).toBe("earlyBirdPriceCents");
  });
});

describe("waluta biletu", () => {
  it("slownik walut pokrywa sie z CHECK-iem bazy i nie ma w nim nic wiecej", () => {
    // Waluta spoza CHECK-a wraca z bazy jako odmowa bez nazwy pola, a lista
    // wyboru w formularzu jest jedynym miejscem, ktore temu zapobiega.
    expect([...TICKET_CURRENCIES]).toEqual(["PLN", "EUR"]);
  });

  it("waluta jedzie do payloadu dokladnie taka, jaka wybrano", () => {
    // Kasa liczy w walucie z biletu; podmiana na domyslna obciazylaby karte
    // w zlotowkach kwota policzona w euro.
    const input = ticketDraftToInput(valid({ currency: "EUR", priceCents: "4900" }), EVENT_ID);
    expect(input.currency).toBe("EUR");
    expect(input.priceCents).toBe(4900);
    expect(input.eventId).toBe(EVENT_ID);
  });

  it("waluta z bazy zapisana malymi literami nie jest rozpoznana i spada do PLN", () => {
    // Porownanie jest na wielkosc liter, wiec `pln` z importu NIE jest `PLN`.
    // Zapisane jako zachowanie, bo formularz oddalby wtedy zlotowki tam, gdzie
    // baza ma napis, ktorego CHECK i tak nie przyjmie.
    expect(ticketDraftFromRow(eventTicketRow({ currency: "pln" })).currency).toBe("PLN");
    expect(ticketDraftFromRow(eventTicketRow({ currency: "EUR" })).currency).toBe("EUR");
  });
});

describe("wiersz bazy -> formularz", () => {
  it("cena promocyjna z bazy wraca do pola jako liczba w groszach", () => {
    // Brak tego przepisania kasowalby promocje przy KAZDEJ edycji biletu -
    // formularz odeslalby puste pole, a to znaczy „zdejmij cene promocyjna".
    const draft = ticketDraftFromRow(
      eventTicketRow({
        early_bird_price_cents: 990,
        early_bird_until: "2026-09-01T08:30:00.000Z",
        price_cents: 1999,
      }),
    );
    expect(draft.earlyBirdPriceCents).toBe("990");
    expect(draft.priceCents).toBe("1999");
    // Termin ma wrocic do pola jako TA SAMA chwila. Sama niepustosc pola
    // przepuscilaby przesuniecie o strefe, czyli promocje konczaca sie
    // godzine za wczesnie albo za pozno - i cene inna niz w cenniku.
    expect(fromLocalInput(draft.earlyBirdUntil)).toBe("2026-09-01T08:30:00.000Z");
  });

  it("bilet bez ceny promocyjnej ma puste pole, a nie zero", () => {
    // Zero znaczyloby „promocja za darmo", czyli bilet gratis dla kazdego,
    // kto zdazy przed terminem.
    expect(ticketDraftFromRow(eventTicketRow()).earlyBirdPriceCents).toBe("");
  });
});

describe("cennik fazowy z JSON-a bazy", () => {
  it("prog bez etykiet i bez okna otwiera sie w formularzu, zamiast wywracac dialog", () => {
    // `price_schedule` jest kolumna `jsonb` bez schematu - prog zapisany przez
    // starsza wersje panelu albo przez import nie ma etykiet. Redaktor ma go
    // zobaczyc i poprawic, a nie dostac pusty dialog.
    const phases = phasesFromJson([
      { price_cents: 12000 },
      { price_cents: 9900, label_pl: 42, label_en: null, from: 17, to: false },
    ]);
    expect(phases).toEqual([
      { labelPl: "", labelEn: "", from: "", to: "", priceCents: "12000" },
      { labelPl: "", labelEn: "", from: "", to: "", priceCents: "9900" },
    ]);
  });

  it("okno progu wraca do pola formularza, a nie do 1970", () => {
    // `from`/`to` sa w JSON-ie znacznikami ISO. Zgubione przy odczycie
    // zamienilyby prog bezterminowy w prog „od zawsze", czyli cena promocyjna
    // obowiazywalaby po terminie.
    const [phase] = phasesFromJson([
      {
        price_cents: 9900,
        label_pl: "Faza I",
        label_en: "Phase I",
        from: "2026-09-01T08:30:00.000Z",
        to: "2026-09-10T08:30:00.000Z",
      },
    ]);
    expect(phase.labelPl).toBe("Faza I");
    expect(phase.labelEn).toBe("Phase I");
    // Obie granice okna wracaja jako TE SAME chwile. Porownanie napisow
    // („from < to") przeszloby takze wtedy, gdyby obie przesunely sie o strefe,
    // a wtedy prog naliczalby sie poza wlasnym terminem.
    expect(fromLocalInput(phase.from)).toBe("2026-09-01T08:30:00.000Z");
    expect(fromLocalInput(phase.to)).toBe("2026-09-10T08:30:00.000Z");
  });

  it("prog bez ceny odpada, bo cennik bez kwoty nie ma czego naliczyc", () => {
    expect(phasesFromJson([{ label_pl: "Faza I" }, { price_cents: "9900" }])).toEqual([]);
  });

  it("cena progu podlega temu samemu sufitowi co cena bazowa", () => {
    const ponadSufit: TicketPhaseDraft = {
      ...emptyTicketPhase(),
      priceCents: String(TICKET_MAX_PRICE_CENTS + 1),
    };
    expect(ticketDraftIssue(valid({ phases: [ponadSufit] }))).toEqual({
      field: "phases",
      errorKey: "invalidPriceSchedule",
    });
  });
});
