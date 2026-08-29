// Walidacja szkicu zgłoszenia - LUSTRO warunków `event_register()`.
//
// Test pilnuje jednej rzeczy, o którą łatwo się potknąć: własna walidacja nie
// może być SUROWSZA od bazy (odrzucałaby poprawne zgłoszenia) ani LUŹNIEJSZA
// (uczestnik traciłby wypełniony formularz na odmowie serwera).
import { describe, expect, it } from "vitest";
import {
  draftAnswers,
  draftOptionalText,
  emptyRegistrationDraft,
  validateRegistrationDraft,
  type RegistrationDraft,
} from "@/lib/events/registrationSubmitDraft";
import type { RegistrationForm } from "@/lib/events/registrationFormSurface";

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
