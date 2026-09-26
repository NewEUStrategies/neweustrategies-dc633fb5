// Publiczny formularz zapisu - EKRAN, NA KTORYM UCZESTNIK ZOSTAWIA DANE.
//
// Sasiedni `components/events/__tests__/publicRegistrationForm.test.tsx` pilnuje
// czterech rzeczy: zamknietych zapisow, zgody obowiazkowej, ksztaltu ladunku i
// bramki „platna wejsciowka wymaga konta". Ten plik domyka RESZTE sciezki
// uczestnika - a wiec wszystko, co dzieje sie, gdy cos idzie NIE TAK, i to, co
// zostaje w reku po wyslaniu.
//
// DZIESIEC RZECZY, KTORE PO ZEPSUCIU KOSZTUJA ZGLOSZENIE ALBO ZAUFANIE:
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
// 8. ODMOWA DOPISANIA GOSCI MOWI O GOSCIACH. `event_register_group_guests`
//    odmawia wlasnymi kodami (`group_too_large`, `already_registered: <email>`),
//    a do tej naprawy szly one przez slownik zapisu prowadzacego i konczyly sie
//    ogolnym „Nie udalo sie zapisac" - choc zgloszenie kupujacego juz stalo.
// 9. ODMOWA GOSCI NIE GUBI LISTY. Zgloszenie prowadzacego zostaje potwierdzone,
//    a goscie wracaja do edycji na ekranie potwierdzenia z przyciskiem
//    ponowienia - ponowny zapis z formularza konczylby sie
//    `already_registered`, wiec bez tego kupujacy tracil osoby, za ktore
//    chcial zaplacic.
// 10. LIMIT W ODMOWIE `group_too_large` JEST Z BAZY, NIE Z FORMULARZA.
//    Formularz tnie liste do limitu znanego przy otwarciu strony, wiec baza
//    odmawia tylko wtedy, gdy organizator limit w miedzyczasie obnizyl -
//    liczba z formularza bylaby w zdaniu zawsze nieprawdziwa. Odczyt limitu
//    idzie osobno (fail-soft) i jego porazka nie zamyka strony zapisu.
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
  sendTicketCodes: vi.fn(),
  checkout: vi.fn(),
  quote: vi.fn(),
}));

/** Zapora przed odpowiedzia RPC - test trzyma zadanie „w trakcie". */
const rpcGate = vi.hoisted((): { current: Promise<void> | null } => ({ current: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string, args?: Record<string, unknown>) => {
      if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
      if (rpcGate.current !== null) await rpcGate.current;
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

vi.mock("@/lib/events/groupTicketCodes.functions", () => ({
  sendGroupTicketCodes: { name: "sendGroupTicketCodes" },
}));

vi.mock("@/lib/billing/checkout.functions", () => ({
  createCheckoutOrder: { name: "createCheckoutOrder" },
}));

vi.mock("@/lib/billing/eventTicketQuote.functions", () => ({
  quoteEventTicketCheckout: { name: "quoteEventTicketCheckout" },
}));

vi.mock("@tanstack/react-start", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-start")>()),
  useServerFn: (fn: { name?: string }) =>
    fn.name === "confirmEventRegistrationEmail"
      ? h.sendConfirmation
      : fn.name === "sendGroupTicketCodes"
        ? h.sendTicketCodes
        : fn.name === "quoteEventTicketCheckout"
          ? h.quote
          : h.checkout,
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
  h.sendTicketCodes.mockReset();
  h.sendTicketCodes.mockResolvedValue({ ok: true, sent: 2 });
  h.checkout.mockReset();
  h.quote.mockReset();
  h.quote.mockResolvedValue({
    seats: 1,
    unitCents: 10000,
    subtotalCents: 10000,
    currency: "PLN",
    coupon: null,
    discountCents: 0,
    totalCents: 10000,
    couponError: null,
  });
  rpcGate.current = null;
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

  it("konto znane PRZED odczytem formularza tez wypelnia pola", async () => {
    // Tozsamosc bywa znana wczesniej niz formularz - i tak jest w praktyce, bo
    // sesje `useAuth` odtwarza z pamieci przegladarki, a formularz wymaga
    // rundy po sieci. Efekt wypelniajacy dane konta zalezy dlatego takze od
    // ISTNIENIA szkicu, a nie od samej tozsamosci: inaczej trafialby na
    // `draft === null`, konczyl sie na `return current` i juz nigdy nie
    // powtarzal, a zalogowany czlonek przepisywalby recznie imie, nazwisko
    // i adres, ktore platforma o nim ma.
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

describe("PublicRegistrationForm - zapis grupowy", () => {
  const GROUP_RPC = "event_register_group_guests";
  const USER: TestUser = { id: "u-lead", email: "anna.kowalska@example.com" };

  function groupForm(over: Record<string, Json> = {}): void {
    stub().setData(
      FORM_RPC,
      formPayload({
        tickets: [ticketRow({ group_registration_enabled: true, group_max_size: 3, ...over })],
      }),
    );
  }

  function guestInput(index: number, part: "first" | "last" | "email"): HTMLInputElement {
    const el = document.getElementById(`group-guest-${index}-${part}`);
    if (!(el instanceof HTMLInputElement)) throw new Error(`test: brak pola gościa ${index}`);
    return el;
  }

  function fillGuest(index: number, email: string): void {
    fireEvent.change(guestInput(index, "first"), { target: { value: "Gość" } });
    fireEvent.change(guestInput(index, "last"), { target: { value: `Numer${index}` } });
    fireEvent.change(guestInput(index, "email"), { target: { value: email } });
  }

  const addButton = () => screen.getByRole("button", { name: /eventRegistration.group.add/ });

  /** Przycisk usunięcia gościa `index` - zawężenie zamiast `!`. */
  function removeButton(index: number): HTMLElement {
    const button = screen.getAllByRole("button", { name: "eventRegistration.group.remove" })[index];
    if (button === undefined) throw new Error(`test: brak przycisku usunięcia gościa ${index}`);
    return button;
  }

  it("limit gości pochodzi z biletu, a nie ze sztywnych 10 osób", async () => {
    h.user = USER;
    groupForm();
    renderForm();

    expect(await screen.findByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    // Prowadzący zajmuje pierwsze miejsce - przy limicie 3 zostaje dwóch gości.
    expect(addButton()).toBeDisabled();
    expect(screen.getByText("eventRegistration.group.seats(count=3)")).toBeInTheDocument();
  });

  it("gość bez konta widzi prośbę o logowanie zamiast listy gości", async () => {
    groupForm();
    renderForm();

    expect(await screen.findByText("eventRegistration.group.accountRequired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eventRegistration.group.add/ })).toBeNull();
  });

  it("zapis dopisuje gości i wysyła bilety z kodem QR kluczem prowadzącego", async () => {
    h.user = USER;
    groupForm();
    stub().setData(GROUP_RPC, { added: 2, registration_ids: [] });
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fillGuest(0, "gosc.jeden@example.com");
    fillGuest(1, "GOSC.DWA@example.com");
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(h.sendTicketCodes).toHaveBeenCalledTimes(1));
    expect(stub().lastCall(GROUP_RPC)?.arg("p_lead_registration_id")).toBe(REGISTRATION_ID);
    expect(stub().lastCall(GROUP_RPC)?.arg("p_guests")).toEqual([
      { first_name: "Gość", last_name: "Numer0", email: "gosc.jeden@example.com" },
      { first_name: "Gość", last_name: "Numer1", email: "gosc.dwa@example.com" },
    ]);
    expect(h.sendTicketCodes).toHaveBeenCalledWith({ data: { manageToken: MANAGE_TOKEN } });
  });

  it("awaria wysyłki biletów nie unieważnia zapisu grupy", async () => {
    h.user = USER;
    groupForm();
    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    h.sendTicketCodes.mockRejectedValue(new Error("network"));
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fillGuest(0, "gosc.jeden@example.com");
    acceptDataProcessing();
    submitForm();

    await waitFor(() => expect(h.sendTicketCodes).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("eventRegistration.actions.back")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("błędny gość zatrzymuje zapis i mówi, co poprawić", async () => {
    h.user = USER;
    groupForm();
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fillGuest(0, "anna.kowalska@example.com");
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("eventRegistration.group.issues.duplicate")).toBeInTheDocument();
    expect(stub().lastCall(REGISTER_RPC)).toBeUndefined();
  });

  /**
   * Formularz otwarty przy limicie 3, prowadzący + dwóch gości, a organizator
   * obniża limit do 2, zanim kupujący kliknie „Zapisz się". Tylko w takim
   * układzie baza odpowiada `group_too_large`: formularz tnie listę do
   * własnego limitu, a świeże zgłoszenie nie ma jeszcze żadnych gości.
   */
  async function submitAfterLimitLowered(): Promise<void> {
    h.user = USER;
    groupForm();
    stub().setError(GROUP_RPC, "group_too_large");
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fillGuest(0, "gosc.jeden@example.com");
    fillGuest(1, "gosc.dwa@example.com");
    acceptDataProcessing();
    groupForm({ group_max_size: 2 });
    submitForm();
    await screen.findByRole("button", { name: "eventRegistration.group.retry.submit" });
  }

  it("odmowa dopisania gości podaje limit Z BAZY, a bilety nie wychodzą", async () => {
    await submitAfterLimitLowered();

    // ZMIANA ASERCJI (dwie). Najpierw wystarczał DOWOLNY alert, a był nim
    // ogólny „Nie udało się zapisać. Spróbuj ponownie." ze słownika zapisu
    // prowadzącego - zdanie nieprawdziwe, bo zgłoszenie kupującego już stało.
    // Potem alert podawał limit 3 z formularza przy liście, która w 3 się
    // mieściła - `group_too_large` pada tylko wtedy, gdy limit w bazie jest
    // NIŻSZY niż znany formularzowi, więc liczba z formularza była w zdaniu
    // zawsze nieprawdziwa. Teraz limit jest czytany od nowa.
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "eventRegistration.group.errors.groupTooLargeMax(max=2)",
      ),
    );
    expect(screen.queryByText(/groupTooLargeMax\(max=3\)/)).toBeNull();
    expect(screen.queryByText("Nie udało się zapisać. Spróbuj ponownie.")).toBeNull();
    expect(h.sendTicketCodes).not.toHaveBeenCalled();
    // Odczyt limitu poszedł osobnym wywołaniem formularza, po odmowie gości.
    expect(stub().callsFor(FORM_RPC)).toHaveLength(2);
    expect(stub().names().lastIndexOf(FORM_RPC)).toBeGreaterThan(
      stub().names().lastIndexOf(GROUP_RPC),
    );
  });

  it("edytor gości przyjmuje limit z bazy: za długiej listy nie da się wysłać, dopóki kupujący jej nie skróci", async () => {
    await submitAfterLimitLowered();

    expect(await screen.findByText("eventRegistration.group.lead(max=2)")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.group.lead(max=3)")).toBeNull();
    // Dwóch gości przy limicie 2 (z prowadzącym) to ta sama odmowa po raz drugi.
    expect(retryButton()).toBeDisabled();
    expect(addButton()).toBeDisabled();

    fireEvent.click(removeButton(1));
    expect(retryButton()).not.toBeDisabled();
    expect(addButton()).toBeDisabled();

    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    fireEvent.click(retryButton());
    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=1)"),
    ).toBeInTheDocument();
    expect(stub().lastCall(GROUP_RPC)?.arg("p_guests")).toEqual([
      { first_name: "Gość", last_name: "Numer0", email: "gosc.jeden@example.com" },
    ]);
  });

  it("nieudany odczyt limitu nie zmyśla liczby i NIE zamyka strony zapisu", async () => {
    h.user = USER;
    groupForm();
    stub().setError(GROUP_RPC, "group_too_large");
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fillGuest(0, "gosc.jeden@example.com");
    acceptDataProcessing();
    stub().setError(FORM_RPC, "Failed to fetch");
    submitForm();
    await screen.findByRole("button", { name: "eventRegistration.group.retry.submit" });

    await waitFor(() => expect(stub().callsFor(FORM_RPC)).toHaveLength(2));
    // Zdanie bez liczby - limitu z formularza nie wolno podać jako prawdy.
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(
        "eventRegistration.group.errors.groupTooLarge",
      ),
    );
    // Odczyt szedł POZA zapytaniem formularza: jego porażka nie przełącza
    // strony w „zapisy niedostępne", a potwierdzenie prowadzącego stoi.
    expect(screen.getByText("eventRegistration.result.approved")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.closed.title")).toBeNull();
    // Edytor zostaje przy limicie z formularza - lepszego nie znamy.
    expect(screen.getByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
    expect(retryButton()).not.toBeDisabled();
  });

  /** Formularz z jednym gościem, którego baza odmówiła - kończy na potwierdzeniu. */
  async function submitWithRefusedGuest(
    refusal: string,
    register: Record<string, Json> = {},
  ): Promise<void> {
    h.user = USER;
    stub().setError(GROUP_RPC, refusal);
    stub().setData(REGISTER_RPC, registerPayload(register));
    renderForm();
    await fillPerson();
    fireEvent.click(addButton());
    fillGuest(0, "gosc.jeden@example.com");
    acceptDataProcessing();
    submitForm();
    await screen.findByRole("button", { name: "eventRegistration.group.retry.submit" });
  }

  const retryButton = () =>
    screen.getByRole("button", { name: /eventRegistration.group.retry.(submit|submitting)/ });

  it("odmowa gości NIE gubi listy: potwierdzenie stoi, a goście wracają do edycji", async () => {
    groupForm();
    await submitWithRefusedGuest("already_registered: gosc.jeden@example.com");

    // Zgłoszenie prowadzącego jest potwierdzone mimo odmowy gości.
    expect(screen.getByText("eventRegistration.result.approved")).toBeInTheDocument();
    expect(screen.getByText(MANAGE_TOKEN)).toBeInTheDocument();
    // Odmowa mówi, KTÓRY gość ma już zapis.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "eventRegistration.group.errors.alreadyRegistered(email=gosc.jeden@example.com)",
    );
    // Lista wpisana w formularzu stoi w polach, edytowalna, w limicie biletu.
    expect(guestInput(0, "first")).toHaveValue("Gość");
    expect(guestInput(0, "last")).toHaveValue("Numer0");
    expect(guestInput(0, "email")).toHaveValue("gosc.jeden@example.com");
    expect(guestInput(0, "email")).not.toBeDisabled();
    expect(screen.getByText("eventRegistration.group.lead(max=3)")).toBeInTheDocument();
    // Formularz zapisu zniknął - ponowny zapis prowadzącego skończyłby się
    // `already_registered`.
    expect(screen.queryByLabelText(label("jobTitle"))).not.toBeInTheDocument();
  });

  it("ponowienie dopisuje gości do TEGO SAMEGO zgłoszenia i wysyła bilety kluczem", async () => {
    groupForm();
    await submitWithRefusedGuest("already_registered: gosc.jeden@example.com");
    expect(h.sendTicketCodes).not.toHaveBeenCalled();

    fireEvent.change(guestInput(0, "email"), { target: { value: "gosc.nowy@example.com" } });
    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    fireEvent.click(retryButton());

    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=1)"),
    ).toBeInTheDocument();
    expect(stub().callsFor(GROUP_RPC)).toHaveLength(2);
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1);
    expect(stub().lastCall(GROUP_RPC)?.arg("p_lead_registration_id")).toBe(REGISTRATION_ID);
    expect(stub().lastCall(GROUP_RPC)?.arg("p_guests")).toEqual([
      { first_name: "Gość", last_name: "Numer0", email: "gosc.nowy@example.com" },
    ]);
    // Ten sam fail-soft, co po udanym zapisie grupy z formularza.
    await waitFor(() =>
      expect(h.sendTicketCodes).toHaveBeenCalledWith({ data: { manageToken: MANAGE_TOKEN } }),
    );
    expect(h.sendTicketCodes).toHaveBeenCalledTimes(1);
    // Odmowa i lista znikają; potwierdzenie prowadzącego zostaje.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.getElementById("group-guest-0-email")).toBeNull();
    expect(screen.getByText("eventRegistration.result.approved")).toBeInTheDocument();
  });

  it("w trakcie ponowienia przycisk jest zablokowany - jedno kliknięcie, jedno żądanie", async () => {
    groupForm();
    await submitWithRefusedGuest("sold_out");
    expect(screen.getByRole("alert")).toHaveTextContent("eventRegistration.group.errors.soldOut");
    let release: () => void = () => {};
    stub().setResponse(GROUP_RPC, { data: { added: 1, registration_ids: [] }, error: null });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    rpcGate.current = gate;

    fireEvent.click(retryButton());

    await waitFor(() => expect(retryButton()).toBeDisabled());
    expect(retryButton()).toHaveTextContent("eventRegistration.group.retry.submitting");
    fireEvent.click(retryButton());
    release();
    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=1)"),
    ).toBeInTheDocument();
    expect(stub().callsFor(GROUP_RPC)).toHaveLength(2);
  });

  it("awaria wysyłki biletów po ponowieniu nie unieważnia dopisanych gości", async () => {
    groupForm();
    h.sendTicketCodes.mockRejectedValue(new Error("network"));
    await submitWithRefusedGuest("group_too_large");

    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    fireEvent.click(retryButton());

    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=1)"),
    ).toBeInTheDocument();
    await waitFor(() => expect(h.sendTicketCodes).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("bez klucza samoobsługi ponowienie nie woła wysyłki biletów", async () => {
    groupForm();
    await submitWithRefusedGuest("group_too_large", { manage_token: null });

    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    fireEvent.click(retryButton());

    expect(
      await screen.findByText("eventRegistration.group.retry.added(count=1)"),
    ).toBeInTheDocument();
    expect(h.sendTicketCodes).not.toHaveBeenCalled();
  });

  it("zgłoszenie płatne: goście przed kasą, a kasa idzie po zgłoszeniu prowadzącego", async () => {
    groupForm({ price_cents: 10000, effective_price_cents: 10000 });
    h.checkout.mockResolvedValue({ ok: true, mode: "stripe", clientSecret: "cs_test_grupa" });
    await submitWithRefusedGuest("group_too_large", {
      status: "pending",
      ticket_type_id: "t-standard",
      payment_required: true,
      payment_status: "unpaid",
      amount_cents: 10000,
      currency: "PLN",
    });
    expect(screen.getByText("eventRegistration.group.retry.beforePayment")).toBeInTheDocument();

    // Podgląd kasy przed dopisaniem gości: jedno miejsce.
    await waitFor(() => expect(h.quote).toHaveBeenCalledTimes(1));
    h.quote.mockResolvedValue({ ...(await h.quote.mock.results[0]?.value), seats: 2 });
    stub().setData(GROUP_RPC, { added: 1, registration_ids: [] });
    fireEvent.click(retryButton());
    await screen.findByText("eventRegistration.group.retry.added(count=1)");
    // Dopisanie gości zmienia liczbę miejsc - rozbicie pod przyciskiem musi się
    // przeliczyć, zanim kupujący kliknie „Zapłać".
    expect(
      await screen.findByText("eventRegistration.payment.quoteSeats(count=2,unit=100,00 zł)"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.payment.payNow" }));

    // Liczbę miejsc liczy `event_registration_group_seats` w funkcji kasy po
    // `registration_id` - po udanym dopisaniu to samo zamówienie obejmuje
    // prowadzącego i gości, bez odświeżania czegokolwiek po stronie klienta.
    await waitFor(() => expect(h.checkout).toHaveBeenCalledTimes(1));
    expect(h.checkout.mock.calls[0]?.[0]).toMatchObject({
      data: { registration_id: REGISTRATION_ID, ticket_type_id: "t-standard" },
    });
  });

  it("rezygnacja z zapisu chowa panel gości - do odwołanego zgłoszenia nic się nie dopisze", async () => {
    groupForm();
    await submitWithRefusedGuest("group_too_large");

    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.cancel" }));

    expect(await screen.findByText("eventRegistration.result.cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /eventRegistration.group.retry/ })).toBeNull();
  });

  it("usunięcie gościa zwalnia miejsce na liście", async () => {
    h.user = USER;
    groupForm();
    renderForm();
    await screen.findByText("eventRegistration.group.lead(max=3)");
    fireEvent.click(addButton());
    fireEvent.click(addButton());
    fireEvent.click(screen.getAllByRole("button", { name: "eventRegistration.group.remove" })[0]!);

    expect(addButton()).not.toBeDisabled();
    expect(screen.getByText("eventRegistration.group.seats(count=2)")).toBeInTheDocument();
  });

  it("bilet z podatkiem doliczanym mówi o tym na karcie", async () => {
    groupForm({ price_cents: 10000, effective_price_cents: 10000, tax_mode: "exclusive" });
    renderForm();

    expect(await screen.findByText("eventRegistration.labels.plusTax")).toBeInTheDocument();
  });
});
