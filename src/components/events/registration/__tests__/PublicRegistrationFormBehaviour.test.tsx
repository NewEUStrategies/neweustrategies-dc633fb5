// Publiczny formularz zapisu - EKRAN, NA KTORYM UCZESTNIK ZOSTAWIA DANE.
//
// Sasiedni `components/events/__tests__/publicRegistrationForm.test.tsx` pilnuje
// czterech rzeczy: zamknietych zapisow, zgody obowiazkowej, ksztaltu ladunku i
// bramki „platna wejsciowka wymaga konta". Ten plik domyka RESZTE sciezki
// uczestnika - a wiec wszystko, co dzieje sie, gdy cos idzie NIE TAK, i to, co
// zostaje w reku po wyslaniu.
//
// SIEDEM RZECZY, KTORE PO ZEPSUCIU KOSZTUJA ZGLOSZENIE ALBO ZAUFANIE:
//
// 1. ODMOWA BAZY NIE KASUJE FORMULARZA. „Limit miejsc" albo „juz zapisany" po
//    wyczyszczeniu pol znaczy, ze uczestnik przepisuje wszystko od nowa - i
//    najczesciej nie przepisuje.
// 2. NIEDOSTEPNY FORMULARZ MOWI POWOD. Odmowa odczytu `event_registration_form`
//    to inny stan swiata niz wydarzenie, ktorego nie ma; jedno „zapisy
//    niedostepne" na oba nie mowi, czy wracac pozniej.
// 3. POLE OBOWIAZKOWE ORGANIZATORA BLOKUJE WYSLANIE - przy KAZDYM z dziesieciu
//    typow pola. Pole dobrowolne nie blokuje niczego i nie jedzie do bazy pustka.
// 4. ZGODY I REGULAMINY MAJA WLASNE ZDANIA. `terms_required` i
//    `missing_required_consents` z bazy nie mowia uczestnikowi, co zaznaczyc.
// 5. POLA OPCJONALNE PUSTE NIE JADA DO RPC. Pusty napis w `p_payload` znaczy w
//    plpgsql „wyczysc", a brak klucza znaczy „nie dotykaj".
// 6. REZYGNACJA DZIALA DLA GOSCIA (kluczem) I DLA WLASCICIELA (identyfikatorem).
// 7. POTWIERDZENIE MAILOWE JEST FAIL-SOFT. Brak maila nie moze uniewaznic
//    zapisu ani wywrocic ekranu potwierdzenia.
//
// ATRAPUJEMY WYLACZNIE GRANICE: klienta Supabase, wywolania server fn (poczta
// potwierdzajaca i kasa), tozsamosc, jezyk interfejsu, toasty i modal operatora
// Stripe. `publicRegistrationApi`, `registrationFormSurface`,
// `registrationSubmitDraft` i wszystkie komponenty potomne formularza jada
// PRAWDZIWE - inaczej test dowodzilby wylacznie tego, ze atrapy sie zgadzaja.
//
// ZAWEZENIE NAJEMCA. Zapis idzie przez publiczne RPC (`event_registration_form`,
// `event_register`, `event_registration_cancel`), wiec asertujemy NAZWE FUNKCJI
// i LADUNEK; samo zawezenie tenantem siedzi w SQL (`public_tenant_id()`) i
// pilnuje go bramka `check:sql-tenant-scope`.
//
// i18n jest zamockowane kluczami (parytetu PL/EN pilnuje osobna bramka
// slownikow). Wyjatkiem sa zdania odmowy: `registrationErrorMessage` liczy je
// POZA Reactem, na prawdziwej instancji i18next - tam asercja czyta to, co
// naprawde zobaczy uczestnik.
//
// RODO: wszystkie dane uczestnika sa syntetyczne, adresy wylacznie w
// domenach example.com / example.org.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Json } from "@/integrations/supabase/types";
import type { RegistrationFieldType } from "@/lib/events/registrationsApi";
import { axeViolations, summarize } from "@/test/axe";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";

interface TestUser {
  id: string;
  email: string | null;
  user_metadata?: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  rpc: null as SupabaseRpcStub | null,
  user: null as TestUser | null,
  lang: "pl" as "pl" | "en",
  sendConfirmation: vi.fn(),
  checkout: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      return h.rpc.rpc(name, args);
    },
  },
}));

vi.mock("react-i18next", async () => (await import("@/test/i18nStub")).reactI18nextStub());

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));

// Moduly server fn ciagna middleware Supabase i SDK Stripe - w tescie
// przegladarkowym potrzebna jest wylacznie ich TOZSAMOSC, po ktorej
// `useServerFn` rozdziela wywolania.
vi.mock("@/lib/events/registrationSelfNotify.functions", () => ({
  confirmEventRegistrationEmail: { name: "confirmEventRegistrationEmail" },
}));

vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "confirmEventRegistrationEmail" ? h.sendConfirmation : h.checkout,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.user, session: h.user === null ? null : { user: h.user } }),
}));

vi.mock("@/lib/i18n/useLang", () => ({ useLang: () => h.lang }));

vi.mock("@/lib/stripe", () => ({ getStripeEnvironment: () => "sandbox" }));

vi.mock("@/components/checkout/LazyEmbeddedCheckoutDialog", () => ({
  LazyEmbeddedCheckoutDialog: ({ clientSecret }: { clientSecret: string | null }) =>
    clientSecret === null ? null : <div data-testid="checkout-modal">{clientSecret}</div>,
}));

const { PublicRegistrationForm } =
  await import("@/components/events/registration/PublicRegistrationForm");

const SLUG = "kongres-cee";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const REGISTRATION_ID = "22222222-2222-2222-2222-222222222222";
/** 24 bajty base64url - dokladnie taki ksztalt daje `_event_new_qr_token()`. */
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

const FORM_RPC = "event_registration_form";
const REGISTER_RPC = "event_register";
const CANCEL_RPC = "event_registration_cancel";

// ---------------------------------------------------------------------------
// LADUNEK RPC W POSTACI, W JAKIEJ ODDAJE GO BAZA (jsonb, snake_case). Parser
// `parseRegistrationForm` jedzie prawdziwy, wiec fixture musi byc surowy -
// gotowy `RegistrationForm` omijalby dokladnie te warstwe, ktora tlumaczy
// odpowiedz SQL na ekran.
// ---------------------------------------------------------------------------
function eventRow(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: EVENT_ID,
    slug: SLUG,
    title_pl: "Kongres CEE 2026",
    title_en: "CEE Congress 2026",
    starts_at: "2026-09-15T08:00:00Z",
    ends_at: null,
    timezone: "Europe/Warsaw",
    registration_mode: "form",
    registration_flow: "instant",
    external_registration_url: null,
    capacity: null,
    seats_left: null,
    rsvp_opens_at: null,
    ...over,
  };
}

function fieldRow(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: "f-diet",
    key: "diet",
    field_type: "text",
    label_pl: "Dieta",
    label_en: "Diet",
    help_pl: "",
    help_en: "",
    is_required: false,
    options: [],
    ...over,
  };
}

function ticketRow(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: "t-standard",
    key: "standard",
    name_pl: "Bilet standardowy",
    name_en: "Standard pass",
    description_pl: "",
    description_en: "",
    price_cents: 0,
    effective_price_cents: 0,
    phase: null,
    benefits_pl: [],
    benefits_en: [],
    currency: "PLN",
    requires_approval: false,
    min_tier_rank: 0,
    sales_from: null,
    sales_to: null,
    seats_left: 10,
    availability: "on_sale",
    tier_locked: false,
    requires_access_code: false,
    access_code_hint: "",
    ...over,
  };
}

function termRow(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: "term-rules",
    key: "rules",
    label_pl: "Regulamin uczestnictwa",
    label_en: "Participation rules",
    body_pl: "",
    body_en: "",
    external_url: null,
    is_required: true,
    version: 3,
    ...over,
  };
}

function formPayload(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    event: eventRow(),
    is_open: true,
    closed_reason: null,
    fields: [],
    consents: [],
    tickets: [],
    terms: [],
    ...over,
  };
}

function registerPayload(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    registration_id: REGISTRATION_ID,
    event_id: EVENT_ID,
    person_id: null,
    status: "approved",
    decision_source: null,
    waitlist_position: null,
    ticket_type_id: null,
    qr_token: null,
    manage_token: MANAGE_TOKEN,
    payment_required: false,
    payment_status: "not_required",
    amount_cents: null,
    currency: null,
    ...over,
  };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

/** Ladunek ostatniego wywolania RPC jako obiekt - asercja po nazwach kluczy. */
function payloadOf(rpcName: string): Record<string, unknown> {
  const arg = stub().lastCall(rpcName)?.arg("p_payload");
  if (typeof arg !== "object" || arg === null || Array.isArray(arg)) {
    throw new Error(`test: ladunek ${rpcName} nie jest obiektem`);
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(arg)) out[key] = value;
  return out;
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicRegistrationForm slug={SLUG} />
    </QueryClientProvider>,
  );
}

const label = (name: string): RegExp => new RegExp(`fields\\.${name}`);

async function fillPerson(): Promise<void> {
  fireEvent.change(await screen.findByLabelText(label("firstName")), {
    target: { value: "Anna" },
  });
  fireEvent.change(screen.getByLabelText(label("lastName")), { target: { value: "Kowalska" } });
  fireEvent.change(screen.getByLabelText(label("email")), {
    target: { value: "anna.kowalska@example.com" },
  });
}

function acceptDataProcessing(): void {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /eventRegistration.consents.dataProcessing/ }),
  );
}

function submitForm(): void {
  fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.submit" }));
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData(FORM_RPC, formPayload());
  h.rpc.setData(REGISTER_RPC, registerPayload());
  h.rpc.setData(CANCEL_RPC, { registration_id: REGISTRATION_ID, promoted_from_waitlist: 0 });
  h.user = null;
  h.lang = "pl";
  h.sendConfirmation.mockReset();
  h.sendConfirmation.mockResolvedValue({ ok: true });
  h.checkout.mockReset();
});

afterEach(cleanup);

// ---------------------------------------------------------------------------
// ZANIM POJAWI SIE FORMULARZ.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - stany przed formularzem", () => {
  it("do czasu odczytu pokazuje szkielet oznaczony jako zajety, a nie pusty ekran", () => {
    const { container } = renderForm();

    // Pusty ekran w trakcie odczytu czyta sie jak wydarzenie bez zapisow -
    // czlowiek wychodzi, zanim formularz zdazy sie pokazac.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByLabelText(label("firstName"))).not.toBeInTheDocument();
    // Wczytywanie NIE moze wygladac jak odpowiedz bazy: ani jak zamkniete
    // zapisy, ani jak gotowy formularz z dzialajacym przyciskiem. Uczestnik,
    // ktory zobaczy „zapisy niedostepne" przez pol sekundy, juz nie wroci.
    expect(screen.queryByText("eventRegistration.closed.title")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "eventRegistration.actions.submit" }),
    ).not.toBeInTheDocument();
  });

  it("odmowa odczytu formularza pokazuje POWOD z bazy, a nie ogolna awarie", async () => {
    stub().setError(FORM_RPC, "registration_disabled");
    renderForm();

    // Zdanie z prawdziwego slownika - to jest napis, ktory zobaczy uczestnik.
    expect(await screen.findByText("To wydarzenie nie przyjmuje zapisów.")).toBeInTheDocument();
    expect(screen.queryByLabelText(label("firstName"))).not.toBeInTheDocument();
  });

  it("odpowiedz bez wydarzenia to „nie znaleziono”, a nie awaria odczytu", async () => {
    // `event: null` degraduje do EMPTY_REGISTRATION_FORM - to inny stan swiata
    // niz odmowa RPC i musi miec inne zdanie.
    stub().setData(FORM_RPC, formPayload({ event: null }));
    renderForm();

    expect(await screen.findByText("eventRegistration.errors.notFound")).toBeInTheDocument();
  });

  it("zamkniete zapisy nie rysuja pol, ale zostawiaja droge powrotna do wydarzenia", async () => {
    stub().setData(
      FORM_RPC,
      formPayload({ is_open: false, closed_reason: "registration_not_open" }),
    );
    renderForm();

    expect(
      await screen.findByText("eventRegistration.closed.registration_not_open"),
    ).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.actions.back").closest("a")).toHaveAttribute(
      "href",
      `/events/${SLUG}`,
    );
  });

  it("zamkniecie bez podanego powodu nie pokazuje pustego zdania", async () => {
    stub().setData(FORM_RPC, formPayload({ is_open: false, closed_reason: null }));
    renderForm();

    expect(await screen.findByText("eventRegistration.closed.unknown")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// JEZYK I TYTUL.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - tytul wydarzenia", () => {
  it("po angielsku pokazuje tytul EN, a nie polski", async () => {
    h.lang = "en";
    renderForm();

    expect(await screen.findByText("CEE Congress 2026")).toBeInTheDocument();
    expect(screen.queryByText("Kongres CEE 2026")).not.toBeInTheDocument();
  });

  it("brak tytulu w jezyku widza spada do slugu - naglowek nie zostaje pusty", async () => {
    // Formularz bez nazwy wydarzenia to prosba o dane osobowe bez powodu.
    h.lang = "en";
    stub().setData(FORM_RPC, formPayload({ event: eventRow({ title_en: "" }) }));
    renderForm();

    expect(await screen.findByText(SLUG)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DANE ZALOGOWANEGO.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - wstepne wypelnienie danych konta", () => {
  /**
   * Sesja Supabase dociera do `useAuth` ASYNCHRONICZNIE (`onAuthStateChange`),
   * wiec `user` zmienia tozsamosc juz po zamontowaniu formularza. Ta pomocnicza
   * odtwarza taka kolejnosc: najpierw jest szkic, potem pojawia sie konto.
   */
  async function signInAfterFormLoads(user: TestUser): Promise<void> {
    const { rerender } = renderForm();
    await screen.findByLabelText(label("firstName"));
    h.user = user;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <PublicRegistrationForm slug={SLUG} />
      </QueryClientProvider>,
    );
  }

  it("zalogowany dostaje swoje dane wpisane, ale POLA ZOSTAJA EDYTOWALNE", async () => {
    // Dane kontaktowe do wydarzenia bywaja inne niz w profilu (adres sluzbowy,
    // inne nazwisko po zmianie) - blokada pol zamienialaby wygode w przeszkode.
    await signInAfterFormLoads({
      id: "u-1",
      email: "anna.kowalska@example.com",
      user_metadata: { first_name: "Anna", last_name: "Kowalska" },
    });

    const email = screen.getByLabelText(label("email"));
    expect(email).toHaveValue("anna.kowalska@example.com");
    expect(email).not.toBeDisabled();
    expect(screen.getByLabelText(label("firstName"))).toHaveValue("Anna");
    expect(screen.getByLabelText(label("lastName"))).toHaveValue("Kowalska");
  });

  it("konto bez imienia w metadanych nie wpisuje „undefined” w pole", async () => {
    await signInAfterFormLoads({ id: "u-1", email: "biuro@example.org", user_metadata: {} });

    expect(screen.getByLabelText(label("email"))).toHaveValue("biuro@example.org");
    expect(screen.getByLabelText(label("firstName"))).toHaveValue("");
  });

  it("zalogowanie w trakcie wypelniania NIE nadpisuje tego, co czlowiek juz wpisal", async () => {
    const { rerender } = renderForm();
    fireEvent.change(await screen.findByLabelText(label("email")), {
      target: { value: "inny.adres@example.org" },
    });

    h.user = {
      id: "u-1",
      email: "konto@example.com",
      user_metadata: { first_name: "Anna", last_name: "Kowalska" },
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={client}>
        <PublicRegistrationForm slug={SLUG} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText(label("email"))).toHaveValue("inny.adres@example.org");
  });

  it.fails("DEFEKT: konto znane PRZED odczytem formularza nie wypelnia zadnego pola", async () => {
    // Efekt wypelniajacy dane konta ma tablice zaleznosci `[user]`, a szkic
    // (`draft`) powstaje dopiero w OSOBNYM efekcie, po odpowiedzi
    // `event_registration_form`. Gdy tozsamosc jest znana wczesniej niz
    // formularz - a tak jest w praktyce, bo sesje `useAuth` odtwarza z
    // pamieci przegladarki, a formularz wymaga rundy po sieci - efekt
    // trafia na `draft === null`, konczy sie instrukcja `return current`
    // i JUZ NIGDY sie nie powtarza (`user` sie nie zmienia).
    //
    // Skutek dla uczestnika: zalogowany czlonek przepisuje recznie imie,
    // nazwisko i adres, ktore platforma o nim ma - dokladnie to, czemu ten
    // efekt mial zapobiec. Brakujaca zaleznoscia jest istnienie szkicu.
    h.user = {
      id: "u-1",
      email: "anna.kowalska@example.com",
      user_metadata: { first_name: "Anna", last_name: "Kowalska" },
    };
    renderForm();

    expect(await screen.findByLabelText(label("email"))).toHaveValue("anna.kowalska@example.com");
  });
});

// ---------------------------------------------------------------------------
// WALIDACJA DANYCH OSOBOWYCH.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - dane osobowe", () => {
  it("bledny adres e-mail zatrzymuje zgloszenie U SIEBIE, bez wywolania RPC", async () => {
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(label("email")), { target: { value: "anna@" } });
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("eventRegistration.validation.email")).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });

  it("adres profilu bez https:// dostaje wlasne zdanie - regula jest lustrem bazy", async () => {
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(label("socialProfile")), {
      target: { value: "http://example.org/anna" },
    });
    acceptDataProcessing();
    submitForm();

    expect(
      await screen.findByText("eventRegistration.validation.socialProfile"),
    ).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });

  it("puste pola opcjonalne NIE jada do RPC - brak klucza to nie to samo, co pustka", async () => {
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    const payload = payloadOf(REGISTER_RPC);
    // W plpgsql `p_payload->>'phone'` z pustym napisem znaczy „wyczysc numer",
    // a brak klucza znaczy „nie dotykaj" - kartoteka osoby nie moze tracic
    // danych tylko dlatego, ze uczestnik nie powtorzyl ich w formularzu.
    expect(payload).not.toHaveProperty("phone");
    expect(payload).not.toHaveProperty("job_title");
    expect(payload).not.toHaveProperty("company_text");
    expect(payload).not.toHaveProperty("social_profile_url");
  });

  it("wypelnione pola opcjonalne jada przyciete, pod kluczami kontraktu", async () => {
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(label("phone")), { target: { value: " 480000000 " } });
    fireEvent.change(screen.getByLabelText(label("jobTitle")), {
      target: { value: " Analityk " },
    });
    fireEvent.change(screen.getByLabelText(label("company")), {
      target: { value: " Instytut Testowy " },
    });
    fireEvent.change(screen.getByLabelText(label("socialProfile")), {
      target: { value: " https://example.org/anna " },
    });
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    const payload = payloadOf(REGISTER_RPC);
    expect(payload.phone).toBe("480000000");
    expect(payload.job_title).toBe("Analityk");
    expect(payload.company_text).toBe("Instytut Testowy");
    expect(payload.social_profile_url).toBe("https://example.org/anna");
  });
});

// ---------------------------------------------------------------------------
// PYTANIA ORGANIZATORA - po jednym przejsciu na KAZDY typ pola.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - pole obowiazkowe blokuje wyslanie", () => {
  const types: ReadonlyArray<RegistrationFieldType> = [
    "text",
    "textarea",
    "select",
    "multiselect",
    "checkbox",
    "switch",
    "number",
    "date",
    "file",
    "consent",
  ];

  for (const fieldType of types) {
    it(`puste pole „${fieldType}” oznaczone jako obowiazkowe nie wola event_register()`, async () => {
      stub().setData(
        FORM_RPC,
        formPayload({
          fields: [
            fieldRow({
              field_type: fieldType,
              is_required: true,
              options: [{ value: "vege", label_pl: "Wegetarianska", label_en: "Vegetarian" }],
            }),
          ],
        }),
      );
      renderForm();
      await fillPerson();
      acceptDataProcessing();
      submitForm();

      // Bez tego uczestnik dostaje `missing_required_fields` dopiero z bazy -
      // komunikat, ktory nie mowi, ktore pole uzupelnic.
      expect(
        await screen.findByText("eventRegistration.validation.requiredField"),
      ).toBeInTheDocument();
      expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
    });
  }

  it("pole dobrowolne pozostawione puste NIE blokuje i nie jedzie do bazy", async () => {
    stub().setData(FORM_RPC, formPayload({ fields: [fieldRow({ is_required: false })] }));
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    // Pusty klucz w `answers` wygladalby jak odpowiedz „nic", a
    // `missing_required_fields` liczy wlasnie obecnosc tresci.
    expect(payloadOf(REGISTER_RPC).answers).toEqual({});
  });

  it("odpowiedzi wielokrotne i liczbowe jada w typach kontraktu, nie jako napisy", async () => {
    stub().setData(
      FORM_RPC,
      formPayload({
        fields: [
          fieldRow({
            id: "f-tracks",
            key: "tracks",
            field_type: "multiselect",
            label_pl: "Sciezki",
            options: [
              { value: "policy", label_pl: "Polityka", label_en: "Policy" },
              { value: "tech", label_pl: "Technologia", label_en: "Technology" },
            ],
          }),
          fieldRow({ id: "f-seats", key: "seats", field_type: "number", label_pl: "Miejsca" }),
        ],
      }),
    );
    renderForm();
    await fillPerson();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Polityka" }));
    fireEvent.change(screen.getByLabelText("Miejsca"), { target: { value: "2" } });
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    // Liczba jako napis przechodzi przez `jsonb`, ale rozjezdza sie z
    // operatorami `gte`/`lte` regul kwalifikujacych, ktore porownuja liczby.
    expect(payloadOf(REGISTER_RPC).answers).toEqual({ tracks: ["policy"], seats: 2 });
  });
});

// ---------------------------------------------------------------------------
// ZGODY ORGANIZATORA I REGULAMINY.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - zgody organizatora", () => {
  const consentRow = fieldRow({
    id: "c-photo",
    key: "photo",
    field_type: "consent",
    label_pl: "Zgoda na wizerunek",
    label_en: "Image consent",
    is_required: true,
  });

  it("wymagana zgoda organizatora blokuje wyslanie i ma WLASNE zdanie", async () => {
    // Do naprawy z migracji `20260828204000` ta petla w ogole nie istniala, a
    // `event_register` zgod WYMAGAL: wymagana zgoda zamykala zapisy na gluchy
    // zamek.
    stub().setData(FORM_RPC, formPayload({ consents: [consentRow] }));
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    expect(
      await screen.findByText("eventRegistration.validation.requiredConsent"),
    ).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });

  it("zaznaczona zgoda organizatora JEDZIE do bazy razem z odpowiedziami", async () => {
    stub().setData(FORM_RPC, formPayload({ consents: [consentRow] }));
    renderForm();
    await fillPerson();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Zgoda na wizerunek *" }));
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    // `answers` w bazie jest JEDNYM obiektem - zgoda musi w nim byc, inaczej
    // `event_register` odrzuci zapis nawet po zaznaczeniu.
    expect(payloadOf(REGISTER_RPC).answers).toEqual({ photo: "true" });
  });

  it("zgody marketingowe sa DOBROWOLNE i jada osobnymi kluczami", async () => {
    // Sklejenie ich ze zgoda na przetwarzanie danych oznaczaloby zgode
    // marketingowa wymuszona warunkiem zapisu.
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    fireEvent.click(screen.getByRole("checkbox", { name: /consents.marketing/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /consents.partnerSharing/ }));
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    const payload = payloadOf(REGISTER_RPC);
    expect(payload.consent_data_processing).toBe(true);
    expect(payload.consent_marketing).toBe(true);
    expect(payload.consent_partner_sharing).toBe(true);
  });

  it("niezaznaczone zgody marketingowe jada jako FALSZ, a nie jako brak klucza", async () => {
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    const payload = payloadOf(REGISTER_RPC);
    expect(payload.consent_marketing).toBe(false);
    expect(payload.consent_partner_sharing).toBe(false);
  });
});

describe("PublicRegistrationForm - regulaminy wydarzenia", () => {
  it("nieakceptowany regulamin obowiazkowy zatrzymuje zgloszenie", async () => {
    stub().setData(FORM_RPC, formPayload({ terms: [termRow()] }));
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    expect(
      await screen.findByText("eventRegistration.validation.requiredTerms"),
    ).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });

  it("zaakceptowany regulamin jedzie do bazy jako identyfikator wiersza", async () => {
    stub().setData(FORM_RPC, formPayload({ terms: [termRow()] }));
    renderForm();
    await fillPerson();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Regulamin uczestnictwa *" }));
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    expect(payloadOf(REGISTER_RPC).accepted_term_ids).toEqual(["term-rules"]);
  });

  it("cofnieta akceptacja ZNIKA z listy - zgoda nie zostaje po odznaczeniu", async () => {
    stub().setData(FORM_RPC, formPayload({ terms: [termRow({ is_required: false })] }));
    renderForm();
    await fillPerson();
    const box = await screen.findByRole("checkbox", { name: "Regulamin uczestnictwa" });
    fireEvent.click(box);
    fireEvent.click(box);
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    // `event_term_acceptances` zapisuje kazda pozycje tej listy - zostawiona
    // po odznaczeniu byloby oswiadczeniem, ktorego uczestnik nie zlozyl.
    expect(payloadOf(REGISTER_RPC).accepted_term_ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BILETY.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - wybor biletu", () => {
  it("przy kilku biletach zaden nie jest wybrany z gory, a brak wyboru blokuje", async () => {
    stub().setData(
      FORM_RPC,
      formPayload({
        tickets: [ticketRow(), ticketRow({ id: "t-vip", key: "vip", name_pl: "Bilet VIP" })],
      }),
    );
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("eventRegistration.validation.ticket")).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });

  it("wybrany bilet jedzie do RPC pod kluczem kontraktu", async () => {
    stub().setData(
      FORM_RPC,
      formPayload({
        tickets: [ticketRow(), ticketRow({ id: "t-vip", key: "vip", name_pl: "Bilet VIP" })],
      }),
    );
    renderForm();
    await fillPerson();
    fireEvent.click(await screen.findByRole("radio", { name: /Bilet VIP/ }));
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
    expect(payloadOf(REGISTER_RPC).ticket_type_id).toBe("t-vip");
  });
});

// ---------------------------------------------------------------------------
// ODMOWA BAZY.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - odmowa zapisu", () => {
  it("odmowa NIE kasuje wypelnionego formularza - to jedyna droga do poprawki", async () => {
    stub().setError(REGISTER_RPC, "already_registered");
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(label("jobTitle")), { target: { value: "Analityk" } });
    acceptDataProcessing();
    submitForm();

    // Zdanie z prawdziwego slownika - `registrationErrorMessage` liczy je poza
    // Reactem, na tej samej instancji i18next, ktora widzi uczestnik.
    expect(
      await screen.findByText("Ten adres ma już aktywny zapis na to wydarzenie."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(label("firstName"))).toHaveValue("Anna");
    expect(screen.getByLabelText(label("jobTitle"))).toHaveValue("Analityk");
    expect(screen.queryByText("eventRegistration.result.approved")).not.toBeInTheDocument();
  });

  it("nieznany kod odmowy dostaje zdanie, po ktorym da sie dzialac", async () => {
    stub().setError(REGISTER_RPC, 'violates check constraint "events_slug_check"');
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("Nie udało się zapisać. Spróbuj ponownie.")).toBeInTheDocument();
  });

  it("odpowiedz bez identyfikatora zapisu NIE rysuje sukcesu bez tresci", async () => {
    // Zapis mogl sie udac, ale bez `registration_id` nie umiemy go pokazac ani
    // odwolac - ekran „gotowe" bylby wtedy obietnica bez pokrycia.
    stub().setData(REGISTER_RPC, { status: "approved" });
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("Nie udało się zapisać. Spróbuj ponownie.")).toBeInTheDocument();
    expect(screen.getByLabelText(label("firstName"))).toHaveValue("Anna");
  });
});

// ---------------------------------------------------------------------------
// PO ZAPISIE.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - po udanym zapisie", () => {
  async function submitHappyPath(over: Record<string, Json> = {}): Promise<void> {
    stub().setData(REGISTER_RPC, registerPayload(over));
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();
    await waitFor(() => expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1));
  }

  it("nazwa RPC i komplet kluczy kontraktu - zawezenie najemca robi SQL", async () => {
    await submitHappyPath();

    expect(stub().lastCall(REGISTER_RPC)?.name).toBe(REGISTER_RPC);
    expect(Object.keys(payloadOf(REGISTER_RPC)).sort()).toEqual([
      "accepted_term_ids",
      "answers",
      "consent_data_processing",
      "consent_marketing",
      "consent_partner_sharing",
      "email",
      "event_slug",
      "first_name",
      "last_name",
      // Wydarzenie bez biletow i tak wysyla `ticket_type_id: null` - jawne
      // „bez biletu" jest tu poprawne, bo `event_register` ZAKLADA wiersz,
      // a nie aktualizuje istniejacego.
      "ticket_type_id",
    ]);
    expect(payloadOf(REGISTER_RPC).event_slug).toBe(SLUG);
  });

  it("formularz znika, a jego miejsce zajmuje potwierdzenie z kluczem samoobslugi", async () => {
    await submitHappyPath();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(screen.queryByLabelText(label("firstName"))).not.toBeInTheDocument();
  });

  it("potwierdzenie mailowe dostaje klucz, ktorym serwer sam odczyta adres", async () => {
    await submitHappyPath();

    // Serwer NIE ufa niczemu poza tym kluczem: adres, jezyk i status bierze
    // z bazy. Wyslanie tu adresu e-mail bylo by otwarciem cudzej skrzynki.
    await waitFor(() =>
      expect(h.sendConfirmation).toHaveBeenCalledWith({ data: { manageToken: MANAGE_TOKEN } }),
    );
  });

  it("odmowa wysylki potwierdzenia NIE uniewaznia zapisu ani nie wywraca ekranu", async () => {
    h.sendConfirmation.mockRejectedValue(new Error("smtp_unavailable"));
    await submitHappyPath();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(screen.getByText("eventRegistration.result.approved")).toBeInTheDocument();
  });

  it("zapis bez klucza samoobslugi nie wola poczty - serwer nie mialby czym uwierzytelnic", async () => {
    await submitHappyPath({ manage_token: null });

    expect(await screen.findByText("eventRegistration.result.approved")).toBeInTheDocument();
    expect(h.sendConfirmation).not.toHaveBeenCalled();
  });

  it("lista rezerwowa mowi POZYCJE, a nie „zapisano”", async () => {
    await submitHappyPath({ status: "waitlist", waitlist_position: 3 });

    expect(
      await screen.findByText("eventRegistration.result.waitlist(position=3)"),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// REZYGNACJA Z EKRANU POTWIERDZENIA.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - rezygnacja tuz po zapisie", () => {
  async function submitAndOpenConfirmation(over: Record<string, Json> = {}): Promise<void> {
    stub().setData(REGISTER_RPC, registerPayload(over));
    renderForm();
    await fillPerson();
    acceptDataProcessing();
    submitForm();
    await screen.findByText("eventRegistration.actions.cancel");
  }

  it("gosc odwoluje zapis KLUCZEM - to jego jedyne poswiadczenie", async () => {
    await submitAndOpenConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.cancel" }));

    await waitFor(() => expect(stub().callsFor(CANCEL_RPC)).toHaveLength(1));
    expect(payloadOf(CANCEL_RPC)).toEqual({ manage_token: MANAGE_TOKEN });
    expect(await screen.findByText("eventRegistration.result.cancelled")).toBeInTheDocument();
  });

  it("bez klucza rezygnacja idzie po identyfikatorze zapisu (wlasciciel konta)", async () => {
    h.user = { id: "u-1", email: "anna.kowalska@example.com" };
    await submitAndOpenConfirmation({ manage_token: null });

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.cancel" }));

    await waitFor(() => expect(stub().callsFor(CANCEL_RPC)).toHaveLength(1));
    expect(payloadOf(CANCEL_RPC)).toEqual({ registration_id: REGISTRATION_ID });
  });

  it("odmowa rezygnacji NIE udaje, ze zapis zostal odwolany", async () => {
    stub().setError(CANCEL_RPC, "already_closed");
    await submitAndOpenConfirmation();

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.cancel" }));

    expect(await screen.findByText("Ten zapis jest już zamknięty.")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.result.cancelled")).not.toBeInTheDocument();
    // Klucz zostaje na ekranie: to nadal jedyna droga do samoobslugi.
    expect(screen.getByText(MANAGE_TOKEN)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// DOSTEPNOSC PELNEGO FORMULARZA.
// ---------------------------------------------------------------------------
describe("PublicRegistrationForm - dostepnosc", () => {
  it("formularz z biletami, pytaniami i zgodami nie ma naruszen dostepnosci", async () => {
    stub().setData(
      FORM_RPC,
      formPayload({
        tickets: [ticketRow()],
        fields: [fieldRow({ is_required: true, help_pl: "Podaj alergie pokarmowe." })],
        consents: [
          fieldRow({
            id: "c-photo",
            key: "photo",
            field_type: "consent",
            label_pl: "Zgoda na wizerunek",
            is_required: true,
          }),
        ],
        terms: [termRow()],
      }),
    );
    const { container } = renderForm();
    await screen.findByLabelText(label("firstName"));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("zdania o bledach stoja przy sekcji, ktorej dotycza", async () => {
    // Lista bledow zebrana na dole formularza kaze szukac pola po omacku -
    // uczestnik czyta „imie jest obowiazkowe" i nie wie, gdzie to imie stoi.
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(label("firstName")), { target: { value: "  " } });
    submitForm();

    const personSection = (await screen.findByText("eventRegistration.sections.person")).closest(
      "section",
    );
    const consentSection = screen
      .getByText("eventRegistration.sections.consents")
      .closest("section");
    // `toContainElement` zamiast porownania sekcji przez `toBe`: gdyby zdanie o
    // bledzie wypadlo poza jakakolwiek sekcje, obie strony porownania bylyby
    // `null` i test przeszedlby na pustce - czyli dokladnie w sytuacji, ktorej
    // ma pilnowac.
    expect(personSection).toContainElement(
      screen.getByText("eventRegistration.validation.firstName"),
    );
    expect(consentSection).toContainElement(
      screen.getByText("eventRegistration.validation.dataProcessing"),
    );
    // I na odwrot - zdanie o zgodzie nie moze wisiec przy danych osobowych.
    expect(personSection).not.toContainElement(
      screen.getByText("eventRegistration.validation.dataProcessing"),
    );
  });
});
