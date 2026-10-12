// Walidacja szkicu zgłoszenia - LUSTRO warunków `event_register()`.
//
// Test pilnuje jednej rzeczy, o którą łatwo się potknąć: własna walidacja nie
// może być SUROWSZA od bazy (odrzucałaby poprawne zgłoszenia) ani LUŹNIEJSZA
// (uczestnik traciłby wypełniony formularz na odmowie serwera).
import { describe, expect, it } from "vitest";
import {
  draftAnswers,
  draftErrorMessageKey,
  draftOptionalText,
  draftAccessCode,
  draftRevealCode,
  emailDiffersFromAccount,
  emptyRegistrationDraft,
  validateGroupLeadEmail,
  validateRegistrationDraft,
  withRememberedAccessCode,
  type RegistrationDraft,
} from "@/lib/events/registrationSubmitDraft";
import type { RegistrationForm } from "@/lib/events/registrationFormSurface";
import { REGISTRATION_FIELD_LIMITS } from "@/lib/events/registrationFieldLimits";

const TICKET = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TERM = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function ticket(
  overrides: Partial<RegistrationForm["tickets"][number]> = {},
): RegistrationForm["tickets"][number] {
  return {
    id: TICKET,
    key: "regular",
    namePl: "Zwykły",
    nameEn: "Regular",
    descriptionPl: "",
    descriptionEn: "",
    priceCents: 0,
    effectivePriceCents: 0,
    phase: { source: "standard", priceCents: 0, labelPl: "", labelEn: "", endsAt: null },
    benefitsPl: [],
    benefitsEn: [],
    currency: "EUR",
    requiresApproval: false,
    minTierRank: 0,
    salesFrom: null,
    salesTo: null,
    seatsLeft: null,
    availability: "on_sale" as const,
    tierLocked: false,
    requiresAccessCode: false,
    accessCodeHint: "",
    ...overrides,
  };
}

function field(overrides: Partial<RegistrationForm["fields"][number]> = {}) {
  return {
    id: "f-1",
    key: "diet",
    fieldType: "text" as const,
    labelPl: "Dieta",
    labelEn: "Diet",
    helpPl: "",
    helpEn: "",
    isRequired: false,
    options: [],
    ...overrides,
  };
}

const form: RegistrationForm = {
  event: {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    slug: "kongres",
    titlePl: "Kongres",
    titleEn: "Congress",
    startsAt: null,
    endsAt: null,
    timezone: "Europe/Warsaw",
    registrationMode: "form",
    registrationFlow: "approval",
    externalRegistrationUrl: null,
    capacity: null,
    seatsLeft: null,
    rsvpOpensAt: null,
  },
  isOpen: true,
  closedReason: null,
  // Zgody stoją tu PUSTE świadomie: ten plik testuje pola i bilety, a osobne
  // przypadki na zgody obowiązkowe siedzą przy nich. Klucz musi jednak być,
  // bo `RegistrationForm` niesie go od migracji `20260828204000` - to była
  // cała treść błędu K-2 (pola typu `consent` w ogóle nie docierały do
  // formularza, więc uczestnik zapisywał się bez ich wyrażenia).
  consents: [],
  fields: [field({ isRequired: true }), field({ id: "f-2", key: "seats", fieldType: "number" })],
  tickets: [ticket()],
  terms: [
    {
      id: TERM,
      key: "rodo",
      labelPl: "RODO",
      labelEn: "GDPR",
      bodyPl: "",
      bodyEn: "",
      externalUrl: null,
      isRequired: true,
      version: 2,
    },
  ],
};

function filled(overrides: Partial<RegistrationDraft> = {}): RegistrationDraft {
  return {
    ...emptyRegistrationDraft(form),
    firstName: "Anna",
    lastName: "Kowalska",
    email: "anna@example.com",
    answers: { diet: "wege" },
    acceptedTermIds: [TERM],
    consentDataProcessing: true,
    ...overrides,
  };
}

function keys(draft: RegistrationDraft): string[] {
  return validateRegistrationDraft(draft, form).map((error) => error.errorKey);
}

describe("emptyRegistrationDraft", () => {
  it("jeden wybieralny bilet zaznacza z góry", () => {
    expect(emptyRegistrationDraft(form).ticketTypeId).toBe(TICKET);
  });

  it("dwa bilety zostawiają wybór uczestnikowi", () => {
    const two = { ...form, tickets: [ticket(), ticket({ id: "t-2", key: "vip" })] };
    expect(emptyRegistrationDraft(two).ticketTypeId).toBeNull();
  });

  it("wydarzenie bez biletów nie zaznacza niczego", () => {
    expect(emptyRegistrationDraft({ ...form, tickets: [] }).ticketTypeId).toBeNull();
  });

  it("sam bilet zablokowany rangą nie zostaje zaznaczony", () => {
    const locked = { ...form, tickets: [ticket({ tierLocked: true })] };
    expect(emptyRegistrationDraft(locked).ticketTypeId).toBeNull();
  });
});

describe("validateRegistrationDraft", () => {
  it("kompletny szkic przechodzi", () => {
    expect(keys(filled())).toEqual([]);
  });

  it("wymaga imienia, nazwiska i poprawnego e-maila", () => {
    expect(keys(filled({ firstName: "  ", lastName: "", email: "anna@example" }))).toEqual([
      "firstName",
      "lastName",
      "email",
    ]);
  });

  it("profil społecznościowy tylko po https, ale pusty jest w porządku", () => {
    expect(keys(filled({ socialProfileUrl: "linkedin.com/in/anna" }))).toEqual(["socialProfile"]);
    expect(keys(filled({ socialProfileUrl: "" }))).toEqual([]);
  });

  it("wymaga zgody na przetwarzanie danych i zgód obowiązkowych", () => {
    expect(keys(filled({ consentDataProcessing: false, acceptedTermIds: [] }))).toEqual([
      "requiredTerms",
      "dataProcessing",
    ]);
  });

  it("bilet spoza sprzedaży nie jest poprawnym wyborem", () => {
    const closed: RegistrationForm = { ...form, tickets: [ticket({ availability: "sold_out" })] };
    expect(validateRegistrationDraft(filled(), closed).map((e) => e.errorKey)).toEqual(["ticket"]);
  });

  it("wejściówka za kodem wymaga kodu dostępu - pole wskazane po nazwie", () => {
    const gated: RegistrationForm = {
      ...form,
      tickets: [ticket({ requiresAccessCode: true, accessCodeHint: "Kod z zaproszenia" })],
    };
    const errors = validateRegistrationDraft(filled({ accessCode: "   " }), gated);
    expect(errors).toEqual([{ field: "accessCode", errorKey: "accessCode" }]);
    expect(validateRegistrationDraft(filled({ accessCode: "PARTNER" }), gated)).toEqual([]);
  });

  it("bilet bez kodu nie pyta o kod, a pusty szkic zaczyna z pustym kodem", () => {
    expect(emptyRegistrationDraft(form).accessCode).toBe("");
    expect(keys(filled({ accessCode: "" }))).toEqual([]);
  });

  it("wejściówka za kodem, ale spoza sprzedaży - mówimy o bilecie, nie o kodzie", () => {
    const closed: RegistrationForm = {
      ...form,
      tickets: [ticket({ requiresAccessCode: true, availability: "sold_out" })],
    };
    expect(validateRegistrationDraft(filled(), closed).map((e) => e.errorKey)).toEqual(["ticket"]);
  });

  it("wydarzenie bez biletów nie wymaga wyboru biletu", () => {
    const free: RegistrationForm = { ...form, tickets: [] };
    const draft = { ...filled(), ticketTypeId: null };
    expect(validateRegistrationDraft(draft, free).map((e) => e.errorKey)).toEqual([]);
  });

  it("puste pole obowiązkowe i nieliczbowa liczba wskazują konkretne pole", () => {
    const errors = validateRegistrationDraft(
      filled({ answers: { diet: "   ", seats: "dwa" } }),
      form,
    );
    expect(errors.map((error) => error.field)).toEqual(["answer:diet", "answer:seats"]);
  });

  it("odhaczony checkbox obowiązkowy liczy się jako odpowiedź", () => {
    const consentForm: RegistrationForm = {
      ...form,
      fields: [field({ key: "photo", fieldType: "checkbox", isRequired: true })],
    };
    const draft = filled({ answers: { photo: "false" } });
    expect(validateRegistrationDraft(draft, consentForm).map((e) => e.errorKey)).toEqual([
      "requiredField",
    ]);
    const accepted = filled({ answers: { photo: "true" } });
    expect(validateRegistrationDraft(accepted, consentForm)).toEqual([]);
  });
});

describe("draftAnswers", () => {
  it("konwertuje typy pól i pomija puste odpowiedzi", () => {
    const multiForm: RegistrationForm = {
      ...form,
      fields: [
        field({ isRequired: true }),
        field({ id: "f-2", key: "seats", fieldType: "number" }),
        field({ id: "f-3", key: "tracks", fieldType: "multiselect" }),
        field({ id: "f-4", key: "photo", fieldType: "switch" }),
        field({ id: "f-5", key: "empty" }),
      ],
    };
    const draft = filled({
      answers: { diet: " wege ", seats: "3", tracks: ["a"], photo: "true", empty: "  " },
    });
    expect(draftAnswers(draft, multiForm)).toEqual([
      { key: "diet", value: "wege" },
      { key: "seats", value: 3 },
      { key: "tracks", value: ["a"] },
      { key: "photo", value: true },
    ]);
  });

  it("odpowiedź na pole, którego formularz nie zawiera, nie jedzie do bazy", () => {
    expect(draftAnswers(filled({ answers: { obce: "x" } }), form)).toEqual([]);
  });
});

describe("draftOptionalText", () => {
  it("puste pole pomijamy, wypełnione przycinamy", () => {
    expect(draftOptionalText("  ")).toBeUndefined();
    expect(draftOptionalText(" NES ")).toBe("NES");
  });
});

describe("draftAccessCode", () => {
  const gated: RegistrationForm = {
    ...form,
    tickets: [ticket({ requiresAccessCode: true })],
  };

  it("wejściówka za kodem: kod znormalizowany z wydarzeniem i biletem", () => {
    expect(draftAccessCode(filled({ accessCode: " partner " }), gated)).toEqual({
      eventId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      ticketTypeId: TICKET,
      code: "PARTNER",
    });
  });

  it("bilet bez kodu, pusty kod, brak biletu albo wydarzenia - nic nie jedzie", () => {
    expect(draftAccessCode(filled({ accessCode: "PARTNER" }), form)).toBeNull();
    expect(draftAccessCode(filled({ accessCode: "  " }), gated)).toBeNull();
    expect(
      draftAccessCode(filled({ accessCode: "PARTNER", ticketTypeId: null }), gated),
    ).toBeNull();
    expect(
      draftAccessCode(filled({ accessCode: "PARTNER" }), { ...gated, event: null }),
    ).toBeNull();
  });
});

describe("withRememberedAccessCode", () => {
  it("uzupełnia puste pole kodem z pamięci", () => {
    expect(withRememberedAccessCode(filled(), "PARTNER")?.accessCode).toBe("PARTNER");
  });

  it("wpisany kod wygrywa, pusta pamięć i brak szkicu niczego nie zmieniają", () => {
    const typed = filled({ accessCode: "WPISANY" });
    expect(withRememberedAccessCode(typed, "PARTNER")).toBe(typed);
    const empty = filled();
    expect(withRememberedAccessCode(empty, "")).toBe(empty);
    expect(withRememberedAccessCode(null, "PARTNER")).toBeNull();
  });
});

describe("odpowiedzi listowe i liczbowe", () => {
  const listForm: RegistrationForm = {
    ...form,
    fields: [
      field({ key: "topics", fieldType: "multiselect", isRequired: true }),
      field({ id: "f-2", key: "seats", fieldType: "number" }),
    ],
  };

  it("obowiązkowy wybór wielokrotny: pusta lista blokuje, niepusta przechodzi", () => {
    expect(
      validateRegistrationDraft(filled({ answers: { topics: [] } }), listForm).map((e) => e.field),
    ).toEqual(["answer:topics"]);
    expect(validateRegistrationDraft(filled({ answers: { topics: ["ai"] } }), listForm)).toEqual(
      [],
    );
  });

  it("liczba podana jako lista to nie liczba - zdanie przy polu", () => {
    const errors = validateRegistrationDraft(
      filled({ answers: { topics: ["ai"], seats: ["1", "2"] } }),
      listForm,
    );
    expect(errors).toEqual([{ field: "answer:seats", errorKey: "number" }]);
  });

  it("pusta lista i nieliczbowa liczba nie jadą do bazy", () => {
    expect(draftAnswers(filled({ answers: { topics: [], seats: "dwa" } }), listForm)).toEqual([]);
  });
});

describe("zgody organizatora", () => {
  const consentForm: RegistrationForm = {
    ...form,
    consents: [field({ id: "c-1", key: "photo_ok", fieldType: "consent", isRequired: true })],
  };

  it("niezaznaczona zgoda obowiązkowa wskazuje swoje pole, zaznaczona przechodzi", () => {
    expect(
      validateRegistrationDraft(
        filled({ answers: { diet: "wege", photo_ok: "false" } }),
        consentForm,
      ),
    ).toEqual([{ field: "answer:photo_ok", errorKey: "requiredConsent" }]);
    expect(
      validateRegistrationDraft(
        filled({ answers: { diet: "wege", photo_ok: "true" } }),
        consentForm,
      ),
    ).toEqual([]);
  });

  it("formularz bez listy zgód (starszy wołający) nie wywraca walidacji ani odpowiedzi", () => {
    const legacy = { ...form, consents: undefined } as unknown as RegistrationForm;
    expect(validateRegistrationDraft(filled(), legacy)).toEqual([]);
    expect(draftAnswers(filled(), legacy)).toEqual([{ key: "diet", value: "wege" }]);
  });
});

// SUFITY DŁUGOŚCI - te same liczby co CHECK-i `event_people` i schemat serwera
// (`REGISTRATION_FIELD_LIMITS`). Granica przechodzi, granica + 1 jest błędem pod
// polem - nigdy przycięciem.
describe("wspólne sufity pól (REGISTRATION_FIELD_LIMITS)", () => {
  const L = REGISTRATION_FIELD_LIMITS;

  it("liczby są równe CHECK-om bazy (imię 80, e-mail 320, telefon 4-40, stanowisko 160, firma 200)", () => {
    expect(L).toMatchObject({
      name: 80,
      email: 320,
      phoneMin: 4,
      phoneMax: 40,
      jobTitle: 160,
      companyText: 200,
      socialProfileUrl: 500,
      code: 64,
    });
  });

  function errorsOf(overrides: Partial<RegistrationDraft>) {
    return validateRegistrationDraft(filled(overrides), form);
  }

  it.each([
    ["firstName", "firstName" as const, L.name],
    ["lastName", "lastName" as const, L.name],
    ["jobTitle", "jobTitle" as const, L.jobTitle],
    ["companyText", "companyText" as const, L.companyText],
  ])("%s: granica przechodzi, granica + 1 to `tooLong` z sufitem", (_label, key, max) => {
    expect(errorsOf({ [key]: "x".repeat(max) })).toEqual([]);
    expect(errorsOf({ [key]: "x".repeat(max + 1) })).toEqual([
      { field: key, errorKey: "tooLong", params: { max } },
    ]);
    // Białe znaki wokół nie są treścią - baza liczy po `btrim`.
    expect(errorsOf({ [key]: `  ${"x".repeat(max)}  ` })).toEqual([]);
  });

  it("e-mail dłuższy niż 320 znaków to `tooLong`, nie `email`", () => {
    const boundary = `${"a".repeat(L.email - 12)}@example.com`;
    expect(boundary).toHaveLength(L.email);
    expect(errorsOf({ email: boundary })).toEqual([]);
    expect(errorsOf({ email: `a${boundary}` })).toEqual([
      { field: "email", errorKey: "tooLong", params: { max: L.email } },
    ]);
  });

  it("telefon: pusty przechodzi, 4..40 przechodzi, poza zakresem - `phoneLength`", () => {
    expect(errorsOf({ phone: "" })).toEqual([]);
    expect(errorsOf({ phone: "1".repeat(L.phoneMin) })).toEqual([]);
    expect(errorsOf({ phone: "1".repeat(L.phoneMax) })).toEqual([]);
    const expected = [
      { field: "phone", errorKey: "phoneLength", params: { min: L.phoneMin, max: L.phoneMax } },
    ];
    expect(errorsOf({ phone: "1".repeat(L.phoneMin - 1) })).toEqual(expected);
    expect(errorsOf({ phone: "1".repeat(L.phoneMax + 1) })).toEqual(expected);
  });

  it("profil zawodowy: sufit 500 sprawdzany przed regułą https", () => {
    const boundary = `https://${"s".repeat(L.socialProfileUrl - 8)}`;
    expect(errorsOf({ socialProfileUrl: boundary })).toEqual([]);
    expect(errorsOf({ socialProfileUrl: `${boundary}s` })).toEqual([
      { field: "socialProfileUrl", errorKey: "tooLong", params: { max: L.socialProfileUrl } },
    ]);
  });

  it("kod dostępu dłuższy niż 64 znaki to `tooLong` przy polu kodu", () => {
    const gated: RegistrationForm = { ...form, tickets: [ticket({ requiresAccessCode: true })] };
    expect(
      validateRegistrationDraft(
        filled({ ticketTypeId: TICKET, accessCode: "K".repeat(L.code) }),
        gated,
      ),
    ).toEqual([]);
    expect(
      validateRegistrationDraft(
        filled({ ticketTypeId: TICKET, accessCode: "K".repeat(L.code + 1) }),
        gated,
      ),
    ).toEqual([{ field: "accessCode", errorKey: "tooLong", params: { max: L.code } }]);
  });

  it("klucz zdania: walidacja pod `validation.*`, ścieżka z kropką pod `eventRegistration.*`", () => {
    expect(draftErrorMessageKey({ field: "phone", errorKey: "phoneLength" })).toBe(
      "eventRegistration.validation.phoneLength",
    );
    expect(draftErrorMessageKey({ field: "email", errorKey: "group.leadEmailMismatch" })).toBe(
      "eventRegistration.group.leadEmailMismatch",
    );
  });
});

describe("bilety ukryte (REG-05)", () => {
  const hiddenOnly: RegistrationForm = {
    ...form,
    tickets: [],
    hasHiddenTickets: true,
    requiresTicket: true,
  };

  it("same bilety ukryte: wybór WYMAGANY, a zdanie mówi o kodzie, nie „wybierz bilet”", () => {
    expect(validateRegistrationDraft(filled({ ticketTypeId: null }), hiddenOnly)).toEqual([
      { field: "ticketTypeId", errorKey: "ticketHiddenOnly" },
    ]);
    // Bez flagi `requiresTicket` (starszy backend) pusta lista nie wymaga biletu.
    expect(
      validateRegistrationDraft(filled({ ticketTypeId: null }), { ...form, tickets: [] }),
    ).toEqual([]);
  });

  it("bilet odsłonięty kodem i doklejony do formularza jest poprawnym wyborem", () => {
    const vip = ticket({ id: "t-vip", key: "vip", isHidden: true });
    const merged: RegistrationForm = { ...hiddenOnly, tickets: [vip] };
    expect(validateRegistrationDraft(filled({ ticketTypeId: "t-vip" }), merged)).toEqual([]);
  });

  it("kod odsłaniający jedzie TYLKO dla biletu ukrytego bez kodu dostępu, który ten kod odsłonił", () => {
    const vip = ticket({ id: "t-vip", key: "vip", isHidden: true });
    const press = ticket({ id: "t-press", key: "press", isHidden: true, requiresAccessCode: true });
    const merged: RegistrationForm = { ...form, tickets: [ticket(), vip, press] };
    const reveal = { code: "VIP-2099", ticketIds: ["t-vip", "t-press"], tickets: [vip, press] };

    expect(draftRevealCode(filled({ ticketTypeId: "t-vip" }), merged, reveal)).toBe("VIP-2099");
    // Bilet jawny, bilet za kodem dostępu, brak odsłonięcia, inny kod - nic nie jedzie.
    expect(draftRevealCode(filled({ ticketTypeId: TICKET }), merged, reveal)).toBeNull();
    expect(draftRevealCode(filled({ ticketTypeId: "t-press" }), merged, reveal)).toBeNull();
    expect(draftRevealCode(filled({ ticketTypeId: "t-vip" }), merged, null)).toBeNull();
    expect(
      draftRevealCode(filled({ ticketTypeId: "t-vip" }), merged, { ...reveal, ticketIds: [] }),
    ).toBeNull();
    expect(draftRevealCode(filled({ ticketTypeId: null }), merged, reveal)).toBeNull();
  });
});

describe("zapis grupowy należy do konta prowadzącego (REG-01)", () => {
  it("z gośćmi adres zgłoszenia MUSI być adresem konta - wielkość liter i spacje nie mają znaczenia", () => {
    const mismatch = validateGroupLeadEmail(filled({ email: "inny@example.com" }), {
      accountEmail: "anna@example.com",
      guestCount: 2,
    });
    expect(mismatch).toEqual({ field: "email", errorKey: "group.leadEmailMismatch" });
    expect(
      validateGroupLeadEmail(filled({ email: "  ANNA@Example.com " }), {
        accountEmail: "anna@example.com",
        guestCount: 2,
      }),
    ).toBeNull();
  });

  it("bez gości albo bez konta reguła nie obowiązuje", () => {
    const draft = filled({ email: "inny@example.com" });
    expect(
      validateGroupLeadEmail(draft, { accountEmail: "anna@example.com", guestCount: 0 }),
    ).toBeNull();
    expect(validateGroupLeadEmail(draft, { accountEmail: null, guestCount: 3 })).toBeNull();
  });

  it("podpowiedź „adres różni się od konta” tylko przy zalogowanym i wpisanym adresie", () => {
    expect(emailDiffersFromAccount("inny@example.com", "anna@example.com")).toBe(true);
    expect(emailDiffersFromAccount(" Anna@Example.com", "anna@example.com")).toBe(false);
    expect(emailDiffersFromAccount("inny@example.com", null)).toBe(false);
    expect(emailDiffersFromAccount("", "anna@example.com")).toBe(false);
  });
});
