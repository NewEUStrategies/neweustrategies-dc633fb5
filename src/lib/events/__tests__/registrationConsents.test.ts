// Zgody w formularzu zapisu - regresja „gluchego zamka".
//
// CO SIE PSULO. `20260827220945` rozdzielilo formularz na pytania kwalifikacyjne
// i zgody, ale wykonalo POLOWE tej zmiany: zapytanie o `fields` dostalo warunek
// `AND f.field_type <> 'consent'`, a druga lista nie powstala i klucza
// `consents` nie bylo w odpowiedzi wcale. W tej samej chwili `event_register`
// zaczal WYMAGAC zaznaczenia kazdej aktywnej, wymaganej zgody.
//
// Skutek: redaktor dodawal wymagana zgode i wydarzenie przestawalo przyjmowac
// zgloszenia. Formularz nie pokazywal pola (nie przyszlo), walidacja klienta go
// nie widziala (chodzila po `form.fields`), serwer odrzucal kazda probe, a kod
// `missing_required_consents` nie mial tlumaczenia - uczestnik dostawal
// generyczne „cos poszlo nie tak" i nie mial jak sie domyslic, co zrobic.
//
// Naprawa ma TRZY czesci i kazda ma tu swoj test:
//   1. RPC oddaje `consents` (migracja `20260828204000`) -> parser je czyta,
//   2. walidacja klienta sprawdza wymagane zgody PRZED wyslaniem,
//   3. `draftAnswers` wysyla odpowiedzi na zgody razem z reszta - bo `answers`
//      w bazie jest jednym obiektem i `event_register` nie wie, z ktorej listy
//      formularza pole przyszlo.
import { describe, expect, it } from "vitest";

import {
  parseRegistrationForm,
  EMPTY_REGISTRATION_FORM,
  type RegistrationForm,
} from "@/lib/events/registrationFormSurface";
import {
  draftAnswers,
  emptyRegistrationDraft,
  validateRegistrationDraft,
  type RegistrationDraft,
} from "@/lib/events/registrationSubmitDraft";

/** Odpowiedz RPC w ksztalcie po naprawie: `fields` bez zgod, `consents` osobno. */
function rpcForm(over: Record<string, unknown> = {}) {
  return {
    event: {
      id: "e-1",
      slug: "summit",
      title_pl: "Szczyt",
      title_en: "Summit",
      starts_at: "2026-09-01T08:00:00Z",
      ends_at: "2026-09-01T16:00:00Z",
      timezone: "Europe/Warsaw",
      registration_mode: "form",
      registration_flow: "instant",
      external_registration_url: null,
      capacity: null,
      seats_left: null,
      rsvp_opens_at: null,
    },
    is_open: true,
    closed_reason: null,
    fields: [
      {
        id: "f-1",
        key: "sektor",
        field_type: "text",
        label_pl: "Sektor",
        label_en: "Sector",
        help_pl: "",
        help_en: "",
        is_required: true,
        options: [],
        sort_order: 1,
      },
    ],
    consents: [
      {
        id: "c-1",
        key: "zgoda_partner",
        field_type: "consent",
        label_pl: "Zgoda na przekazanie danych partnerowi",
        label_en: "Consent to share data with the partner",
        help_pl: "",
        help_en: "",
        is_required: true,
        options: [],
        sort_order: 1,
      },
      {
        id: "c-2",
        key: "zgoda_foto",
        field_type: "consent",
        label_pl: "Zgoda na wizerunek",
        label_en: "Photo consent",
        help_pl: "",
        help_en: "",
        is_required: false,
        options: [],
        sort_order: 2,
      },
    ],
    tickets: [],
    terms: [],
    ...over,
  };
}

/** Szkic gotowy do wyslania - wszystko poza zgodami wypelnione poprawnie. */
function readyDraft(form: RegistrationForm): RegistrationDraft {
  return {
    ...emptyRegistrationDraft(form),
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.org",
    answers: { sektor: "publiczny" },
    consentDataProcessing: true,
  };
}

describe("parseRegistrationForm - klucz `consents`", () => {
  it("czyta zgody jako OSOBNA liste, nie dokleja ich do pytan", () => {
    const form = parseRegistrationForm(rpcForm());
    expect(form.fields.map((f) => f.key)).toEqual(["sektor"]);
    expect(form.consents.map((c) => c.key)).toEqual(["zgoda_partner", "zgoda_foto"]);
  });

  it("zgody maja ten sam ksztalt co pytania - jeden mapper, nie dwie kopie", () => {
    const form = parseRegistrationForm(rpcForm());
    const consent = form.consents[0];
    expect(consent).toMatchObject({
      id: "c-1",
      key: "zgoda_partner",
      fieldType: "consent",
      labelPl: "Zgoda na przekazanie danych partnerowi",
      labelEn: "Consent to share data with the partner",
      isRequired: true,
    });
  });

  it("brak klucza `consents` w odpowiedzi czyta jako brak zgod, nie jako awarie", () => {
    const source = rpcForm();
    delete (source as Record<string, unknown>).consents;
    expect(parseRegistrationForm(source).consents).toEqual([]);
  });

  it("pusty formularz startowy ma liste zgod, a nie `undefined`", () => {
    expect(EMPTY_REGISTRATION_FORM.consents).toEqual([]);
  });
});

describe("validateRegistrationDraft - wymagane zgody", () => {
  it("REGRESJA: brak wymaganej zgody zatrzymuje szkic U KLIENTA", () => {
    const form = parseRegistrationForm(rpcForm());
    const errors = validateRegistrationDraft(readyDraft(form), form);
    expect(errors).toContainEqual({ field: "answer:zgoda_partner", errorKey: "requiredConsent" });
  });

  it("zaznaczona wymagana zgoda przepuszcza szkic", () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "true" };
    expect(validateRegistrationDraft(draft, form)).toEqual([]);
  });

  it("zgoda NIEwymagana nie blokuje niczego", () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "true" };
    const errors = validateRegistrationDraft(draft, form);
    expect(errors.some((e) => e.field === "answer:zgoda_foto")).toBe(false);
  });

  it('zgoda odznaczona jawnie („false") liczy sie jak brak zgody', () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "false" };
    expect(validateRegistrationDraft(draft, form)).toContainEqual({
      field: "answer:zgoda_partner",
      errorKey: "requiredConsent",
    });
  });

  it("formularz bez klucza `consents` nie wywraca walidacji", () => {
    const form = { ...parseRegistrationForm(rpcForm()) } as RegistrationForm;
    delete (form as Partial<RegistrationForm>).consents;
    expect(() => validateRegistrationDraft(readyDraft(form), form)).not.toThrow();
  });
});

describe("draftAnswers - odpowiedzi na zgody jada do bazy", () => {
  it("REGRESJA: zaznaczona zgoda jest w ladunku, nie gubi sie miedzy listami", () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "true" };
    const answers = draftAnswers(draft, form);
    expect(answers).toContainEqual({ key: "zgoda_partner", value: "true" });
  });

  it("odpowiedzi na pytania kwalifikacyjne nadal jada", () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "true" };
    expect(draftAnswers(draft, form)).toContainEqual({ key: "sektor", value: "publiczny" });
  });

  it("niezaznaczona zgoda nieobowiazkowa nie zasmieca ladunku", () => {
    const form = parseRegistrationForm(rpcForm());
    const draft = readyDraft(form);
    draft.answers = { ...draft.answers, zgoda_partner: "true" };
    expect(draftAnswers(draft, form).some((a) => a.key === "zgoda_foto")).toBe(false);
  });

  it("formularz bez klucza `consents` nie wywraca skladania ladunku", () => {
    const form = { ...parseRegistrationForm(rpcForm()) } as RegistrationForm;
    delete (form as Partial<RegistrationForm>).consents;
    expect(() => draftAnswers(readyDraft(form), form)).not.toThrow();
  });
});

describe("kontrakt z migracja - klucz `consents` istnieje po stronie bazy", () => {
  it("najnowsza definicja `event_registration_form` oddaje `consents`", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "supabase", "migrations");
    let body = "";
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(join(dir, file), "utf8");
      const at = sql.toLowerCase().indexOf("function public.event_registration_form(");
      if (at === -1) continue;
      const start = sql.toLowerCase().lastIndexOf("create", at);
      const end = sql.indexOf("$$;", start);
      body = sql.slice(start, end === -1 ? undefined : end);
    }
    expect(body.length, "nie znaleziono definicji event_registration_form").toBeGreaterThan(500);
    expect(body).toContain("'consents', v_consents");
    expect(body).toContain("f.field_type = 'consent'");
  });
});
