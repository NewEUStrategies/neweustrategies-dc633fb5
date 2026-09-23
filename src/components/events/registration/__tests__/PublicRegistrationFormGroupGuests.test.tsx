// Organizm „Publiczny formularz zapisu" - ZAPIS GRUPOWY: bilet, który pozwala
// prowadzącemu zapisać razem z sobą kilka osób, i lista tych osób.
//
// CO TEN PLIK DOWODZI.
//   1. SEKCJA GOŚCI ISTNIEJE TYLKO PRZY BILECIE Z ZAPISEM GRUPOWYM. Zwykły bilet
//      jej nie rysuje, a gość bez konta widzi zdanie o logowaniu zamiast pól -
//      `event_register_group_guests` ma GRANT wyłącznie dla `authenticated`.
//   2. GOŚCIE JADĄ DO BAZY DOPIERO PO ZAPISIE PROWADZĄCEGO, przypięci jego
//      identyfikatorem, z danymi przyciętymi i adresem małymi literami.
//   3. BŁĘDNY GOŚĆ ZATRZYMUJE WYSŁANIE U SIEBIE: brak nazwiska, zły adres albo
//      adres prowadzącego na liście gości - bez żadnego wywołania RPC. Każda
//      zmiana listy zdejmuje komunikaty, bo odnosiły się do starej listy.
//   4. ODMOWA DOPISANIA GOŚCI NIE COFA ZAPISU PROWADZĄCEGO: potwierdzenie stoi,
//      mail do prowadzącego wychodzi, a powód odmowy widać nad potwierdzeniem.
//   5. GOŚCIE ZOSTAJĄ W FORMULARZU, GDY PRZESTAJĄ MIEĆ SENS: po zmianie biletu na
//      zwykły albo po wylogowaniu lista nie jedzie do bazy, która by jej nie
//      przyjęła.
//   6. BILET WYCOFANY W TRAKCIE WYPEŁNIANIA (odświeżony formularz już go nie ma)
//      nie zostawia po sobie wymogu konta ani sekcji gości, a wysłanie mówi,
//      że trzeba wybrać bilet.
//   7. DANE KONTA NIE NADPISUJĄ TEGO, CO CZŁOWIEK WPISAŁ: imię i nazwisko
//      wpisane przed zalogowaniem zostają, dochodzi tylko adres z konta.
//   8. ZAMKNIĘCIE BEZ POWODU (`closedReason: null`) mówi „nieznany powód", a nie
//      pokazuje klucza sklejonego z `null`.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reszty ścieżki uczestnika (pola organizatora,
// zgody, regulaminy, odmowy `event_register`, rezygnacja) - ma ją
// `PublicRegistrationFormBehaviour.test.tsx`; bramki „płatna wejściówka wymaga
// konta" - ma ją `components/events/__tests__/publicRegistrationForm.test.tsx`.
// Reguł walidacji gości (`guestIssues`) - mają tabelę przypadków w
// `lib/events/__tests__/ticketTaxGroup.test.ts`; tutaj jadą PRAWDZIWE, bo
// dowodem jest to, że formularz przez nie przechodzi. Samej molekuły listy gości
// - ma ją `GroupGuestsEditor.test.tsx`.
//
// ATRAPUJEMY WYŁĄCZNIE GRANICE, jak w pliku zachowań: klienta Supabase (RPC),
// server fn poczty i kasy, tożsamość, język, toasty i modal Stripe. Parser
// formularza i wszystkie komponenty potomne jadą prawdziwe. Wyjątkiem jest
// punkt 8 - kształt, którego parser nie oddaje, podajemy z pominięciem parsera.
//
// RODO: dane osób są syntetyczne, adresy wyłącznie w domenach example.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { Json } from "@/integrations/supabase/types";
import type { RegistrationForm } from "@/lib/events/registrationFormSurface";
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
  formOverride: null as RegistrationForm | null,
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

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.lang),
);

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock("@tanstack/react-router", async () => ({
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useNavigate: () => vi.fn(),
}));

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

// Parser zostaje prawdziwy; podmiana wchodzi WYŁĄCZNIE wtedy, gdy test poda
// gotowy formularz (punkt 8).
vi.mock("@/lib/events/publicRegistrationApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/events/publicRegistrationApi")>();
  return {
    ...actual,
    fetchRegistrationForm: (slug: string) =>
      h.formOverride === null
        ? actual.fetchRegistrationForm(slug)
        : Promise.resolve(h.formOverride),
  };
});

const { PublicRegistrationForm } =
  await import("@/components/events/registration/PublicRegistrationForm");

const SLUG = "kongres-cee";
const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const REGISTRATION_ID = "22222222-2222-2222-2222-222222222222";
const MANAGE_TOKEN = "Ab3d_Xy9-Qw1zEr4TyU7iOp2AsDf1gHj";

const FORM_RPC = "event_registration_form";
const REGISTER_RPC = "event_register";
const GUESTS_RPC = "event_register_group_guests";

const G = "eventRegistration.group";

const LEAD: TestUser = {
  id: "u-lead",
  email: "anna.kowalska@example.com",
  user_metadata: { first_name: "Anna", last_name: "Kowalska" },
};

function eventRow(): Record<string, Json> {
  return {
    id: EVENT_ID,
    slug: SLUG,
    title_pl: "Kongres CEE",
    title_en: "CEE Congress",
    starts_at: null,
    ends_at: null,
    timezone: "Europe/Warsaw",
    registration_mode: "form",
    registration_flow: "instant",
    external_registration_url: null,
    capacity: null,
    seats_left: null,
    rsvp_opens_at: null,
  };
}

function ticketRow(over: Record<string, Json> = {}): Record<string, Json> {
  return {
    id: "t-group",
    key: "group",
    name_pl: "Bilet grupowy",
    name_en: "Group pass",
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
    seats_left: 40,
    availability: "on_sale",
    tier_locked: false,
    requires_access_code: false,
    access_code_hint: "",
    group_registration_enabled: true,
    ...over,
  };
}

const STANDARD = ticketRow({
  id: "t-standard",
  key: "standard",
  name_pl: "Bilet zwykły",
  name_en: "Standard pass",
  group_registration_enabled: false,
});

function formPayload(tickets: Record<string, Json>[]): Record<string, Json> {
  return {
    event: eventRow(),
    is_open: true,
    closed_reason: null,
    fields: [],
    consents: [],
    tickets,
    terms: [],
  };
}

function registerPayload(): Record<string, Json> {
  return {
    registration_id: REGISTRATION_ID,
    event_id: EVENT_ID,
    person_id: null,
    status: "approved",
    decision_source: null,
    waitlist_position: null,
    ticket_type_id: "t-group",
    qr_token: null,
    manage_token: MANAGE_TOKEN,
    payment_required: false,
    payment_status: "not_required",
    amount_cents: null,
    currency: null,
  };
}

function stub(): SupabaseRpcStub {
  if (h.rpc === null) throw new Error("test: atrapa RPC nie zostala ustawiona");
  return h.rpc;
}

/** Jeden klient zapytań na cały test - `rerender` zmienia tylko tożsamość. */
function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={client}>
      <PublicRegistrationForm slug={SLUG} />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { client, rerender: () => view.rerender(tree()) };
}

const label = (name: string): RegExp => new RegExp(`fields\\.${name}`);

const addButton = (): HTMLElement => screen.getByRole("button", { name: `${G}.add` });

/** Fieldset gościa po numerze miejsca (prowadzący zajmuje miejsce 1). */
const guestBox = (seat: number): HTMLElement =>
  screen.getByRole("group", { name: `${G}.person(n=${seat})` });

function fillGuest(seat: number, first: string, last: string, email: string): void {
  const box = within(guestBox(seat));
  fireEvent.change(box.getByLabelText("eventRegistration.fields.firstName"), {
    target: { value: first },
  });
  fireEvent.change(box.getByLabelText("eventRegistration.fields.lastName"), {
    target: { value: last },
  });
  fireEvent.change(box.getByLabelText("eventRegistration.fields.email"), {
    target: { value: email },
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

async function fillAnonymousLead(): Promise<void> {
  fireEvent.change(await screen.findByLabelText(label("firstName")), {
    target: { value: "Anna" },
  });
  fireEvent.change(screen.getByLabelText(label("lastName")), { target: { value: "Kowalska" } });
  fireEvent.change(screen.getByLabelText(label("email")), {
    target: { value: "anna.kowalska@example.com" },
  });
}

beforeEach(() => {
  h.rpc = supabaseRpcStub();
  h.rpc.setData(FORM_RPC, formPayload([ticketRow()]));
  h.rpc.setData(REGISTER_RPC, registerPayload());
  h.rpc.setData(GUESTS_RPC, {
    added: 1,
    registration_ids: ["33333333-3333-3333-3333-333333333333"],
  });
  h.user = null;
  h.lang = "pl";
  h.formOverride = null;
  h.sendConfirmation.mockReset();
  h.sendConfirmation.mockResolvedValue({ ok: true });
  h.checkout.mockReset();
});

afterEach(cleanup);

describe("zapis grupowy - kto widzi sekcję gości", () => {
  it("zwykły bilet nie rysuje sekcji gości", async () => {
    stub().setData(FORM_RPC, formPayload([STANDARD]));
    h.user = LEAD;
    renderForm();

    await screen.findByLabelText(label("firstName"));
    expect(screen.queryByText(`${G}.title`)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${G}.add` })).not.toBeInTheDocument();
  });

  it("zalogowany z biletem grupowym widzi sekcję gości z limitem osób", async () => {
    h.user = LEAD;
    renderForm();

    expect(await screen.findByText(`${G}.title`)).toBeInTheDocument();
    expect(screen.getByText(`${G}.lead(max=10)`)).toBeInTheDocument();
    expect(addButton()).not.toBeDisabled();
  });

  it("gość bez konta widzi prośbę o zalogowanie zamiast pól gości", async () => {
    renderForm();

    expect(await screen.findByText(`${G}.accountRequired`)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `${G}.add` })).not.toBeInTheDocument();
  });

  it("gość bez konta zapisuje się sam - baza nie dostaje listy gości", async () => {
    renderForm();
    await fillAnonymousLead();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(1);
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(0);
  });
});

describe("zapis grupowy - zalogowany prowadzący", () => {
  it("goście jadą do bazy PO zapisie prowadzącego, przypięci do jego zgłoszenia", async () => {
    h.user = LEAD;
    renderForm();
    expect(await screen.findByLabelText(label("email"))).toHaveValue(LEAD.email);

    fireEvent.click(addButton());
    fillGuest(2, " Ewa ", " Nowak ", " Ewa.Nowak@Example.org ");
    fireEvent.click(addButton());
    fillGuest(3, "Jan", "Wiśniewski", "jan.wisniewski@example.org");
    expect(screen.getByText(`${G}.seats(count=3)`)).toBeInTheDocument();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(
      stub()
        .names()
        .filter((name) => name === REGISTER_RPC || name === GUESTS_RPC),
    ).toEqual([REGISTER_RPC, GUESTS_RPC]);
    const call = stub().lastCall(GUESTS_RPC);
    expect(call?.arg("p_lead_registration_id")).toBe(REGISTRATION_ID);
    expect(call?.arg("p_guests")).toEqual([
      { first_name: "Ewa", last_name: "Nowak", email: "ewa.nowak@example.org" },
      { first_name: "Jan", last_name: "Wiśniewski", email: "jan.wisniewski@example.org" },
    ]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("zalogowany bez dodanych gości zapisuje tylko siebie", async () => {
    h.user = LEAD;
    renderForm();
    await screen.findByText(`${G}.title`);
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(0);
  });

  it("adres prowadzącego na liście gości zatrzymuje wysłanie bez wołania bazy", async () => {
    h.user = LEAD;
    renderForm();
    await screen.findByText(`${G}.title`);

    fireEvent.click(addButton());
    fillGuest(2, "Anna", "Kowalska", "ANNA.KOWALSKA@example.com");
    acceptDataProcessing();
    submitForm();

    expect(await within(guestBox(2)).findByRole("alert")).toHaveTextContent(
      `${G}.issues.duplicate`,
    );
    expect(within(guestBox(2)).getByLabelText("eventRegistration.fields.email")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(0);
  });

  it("gość bez nazwiska i gość ze złym adresem dostają własne zdania; zmiana listy je zdejmuje", async () => {
    h.user = LEAD;
    renderForm();
    await screen.findByText(`${G}.title`);

    fireEvent.click(addButton());
    fillGuest(2, "Ewa", "  ", "ewa.nowak@example.org");
    fireEvent.click(addButton());
    fillGuest(3, "Jan", "Wiśniewski", "jan@");
    acceptDataProcessing();
    submitForm();

    expect(await within(guestBox(2)).findByRole("alert")).toHaveTextContent(`${G}.issues.name`);
    expect(within(guestBox(3)).getByRole("alert")).toHaveTextContent(`${G}.issues.email`);
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);

    fireEvent.change(within(guestBox(2)).getByLabelText("eventRegistration.fields.lastName"), {
      target: { value: "Nowak" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("odmowa dopisania gości NIE cofa zapisu prowadzącego - powód stoi nad potwierdzeniem", async () => {
    stub().setError(GUESTS_RPC, "already_registered: ewa.nowak@example.org");
    h.user = LEAD;
    renderForm();
    await screen.findByText(`${G}.title`);

    fireEvent.click(addButton());
    fillGuest(2, "Ewa", "Nowak", "ewa.nowak@example.org");
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    // Zdanie z prawdziwego słownika - `registrationErrorMessage` liczy je poza
    // Reactem, na tej samej instancji i18next, którą widzi uczestnik.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Ten adres ma już aktywny zapis na to wydarzenie.",
    );
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(1);
    await waitFor(() =>
      expect(h.sendConfirmation).toHaveBeenCalledWith({ data: { manageToken: MANAGE_TOKEN } }),
    );
  });
});

describe("zapis grupowy - lista gości, która przestała mieć sens", () => {
  it("zmiana biletu na zwykły chowa sekcję gości i nie wysyła wpisanej listy", async () => {
    stub().setData(FORM_RPC, formPayload([ticketRow(), STANDARD]));
    h.user = LEAD;
    renderForm();

    fireEvent.click(await screen.findByRole("radio", { name: /Bilet grupowy/ }));
    fireEvent.click(addButton());
    fillGuest(2, "Ewa", "Nowak", "ewa.nowak@example.org");
    fireEvent.click(screen.getByRole("radio", { name: /Bilet zwykły/ }));
    expect(screen.queryByText(`${G}.title`)).not.toBeInTheDocument();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    const payload = stub().lastCall(REGISTER_RPC)?.arg("p_payload");
    expect(payload).toMatchObject({ ticket_type_id: "t-standard" });
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(0);
  });

  it("wylogowanie po wpisaniu gości chowa pola i zapisuje wyłącznie prowadzącego", async () => {
    h.user = LEAD;
    const { rerender } = renderForm();
    await screen.findByText(`${G}.title`);
    fireEvent.click(addButton());
    fillGuest(2, "Ewa", "Nowak", "ewa.nowak@example.org");

    h.user = null;
    rerender();

    expect(screen.getByText(`${G}.accountRequired`)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: `${G}.person(n=2)` })).not.toBeInTheDocument();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText(MANAGE_TOKEN)).toBeInTheDocument();
    expect(stub().callsFor(GUESTS_RPC)).toHaveLength(0);
  });
});

describe("bilet wycofany w trakcie wypełniania", () => {
  it("odświeżony formularz bez wybranego biletu zdejmuje wymóg konta i sekcję gości", async () => {
    stub().setData(
      FORM_RPC,
      formPayload([ticketRow({ price_cents: 15000, effective_price_cents: 15000 })]),
    );
    const { client } = renderForm();
    expect(
      await screen.findByText("eventRegistration.payment.accountRequiredTitle"),
    ).toBeInTheDocument();
    expect(screen.getByText(`${G}.accountRequired`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "eventRegistration.actions.submit" })).toBeDisabled();

    stub().setData(FORM_RPC, formPayload([STANDARD]));
    await act(async () => {
      await client.refetchQueries();
    });

    expect(await screen.findByRole("radio", { name: /Bilet zwykły/ })).not.toBeChecked();
    expect(
      screen.queryByText("eventRegistration.payment.accountRequiredTitle"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(`${G}.title`)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "eventRegistration.actions.submit" }),
    ).not.toBeDisabled();

    await fillAnonymousLead();
    acceptDataProcessing();
    submitForm();

    expect(await screen.findByText("eventRegistration.validation.ticket")).toBeInTheDocument();
    expect(stub().callsFor(REGISTER_RPC)).toHaveLength(0);
  });
});

describe("dane konta a to, co człowiek już wpisał", () => {
  it("imię i nazwisko wpisane przed zalogowaniem zostają, adres przychodzi z konta", async () => {
    stub().setData(FORM_RPC, formPayload([STANDARD]));
    const { rerender } = renderForm();
    fireEvent.change(await screen.findByLabelText(label("firstName")), {
      target: { value: "Ewa" },
    });
    fireEvent.change(screen.getByLabelText(label("lastName")), { target: { value: "Nowak" } });

    h.user = LEAD;
    rerender();

    expect(screen.getByLabelText(label("email"))).toHaveValue(LEAD.email);
    expect(screen.getByLabelText(label("firstName"))).toHaveValue("Ewa");
    expect(screen.getByLabelText(label("lastName"))).toHaveValue("Nowak");
  });
});

describe("zamknięcie bez podanego powodu", () => {
  it("formularz zamknięty z powodem `null` mówi „nieznany powód”", async () => {
    h.formOverride = {
      event: {
        id: EVENT_ID,
        slug: SLUG,
        titlePl: "Kongres CEE",
        titleEn: "CEE Congress",
        startsAt: null,
        endsAt: null,
        timezone: null,
        registrationMode: "form",
        registrationFlow: "instant",
        externalRegistrationUrl: null,
        capacity: null,
        seatsLeft: null,
        rsvpOpensAt: null,
      },
      isOpen: false,
      closedReason: null,
      fields: [],
      consents: [],
      tickets: [],
      terms: [],
    };
    renderForm();

    expect(await screen.findByText("eventRegistration.closed.unknown")).toBeInTheDocument();
    expect(screen.queryByText("eventRegistration.closed.null")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(label("firstName"))).not.toBeInTheDocument();
  });
});
