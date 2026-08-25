// Publiczny formularz zapisu: to, co najlatwiej zepsuc na scieżce uczestnika.
//
// SPRAWDZAMY KONTRAKT, NIE NAPISY. i18n jest zamockowane kluczami (jak w
// pozostalych testach komponentow), bo parzystosc PL/EN pilnuje osobna bramka
// slownikow. Tu chodzi o cztery rzeczy, ktore po zepsuciu kosztuja zgloszenie:
// 1. zamkniete zapisy nie rysuja formularza, tylko POWOD z bazy,
// 2. brak zgody obowiazkowej nie wysyla nic do `event_register()`,
// 3. poprawny szkic jedzie do RPC w kluczach kontraktu (bilet, odpowiedzi, zgody),
// 4. `manage_token` widac po zapisie, bo baza trzyma tylko jego SHA-256.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { RegistrationForm } from "@/lib/events/registrationFormSurface";
import type { RegisterInput } from "@/lib/events/publicRegistrationApi";

const fetchForm = vi.fn<(slug: string) => Promise<RegistrationForm>>();
const register = vi.fn<(input: RegisterInput) => Promise<unknown>>();
const cancel = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "pl", changeLanguage: () => Promise.resolve() },
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a href="/events/kongres">{children}</a>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock("@/lib/i18n/useLang", () => ({
  useLang: () => "pl",
}));

vi.mock("@/lib/events/publicRegistrationApi", () => ({
  fetchRegistrationForm: (slug: string) => fetchForm(slug),
  submitRegistration: (input: RegisterInput) => register(input),
  cancelRegistration: (input: unknown) => cancel(input),
}));

const { PublicRegistrationForm } = await import(
  "@/components/events/registration/PublicRegistrationForm"
);

const EVENT = {
  id: "e1",
  slug: "kongres",
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
};

function openForm(overrides: Partial<RegistrationForm> = {}): RegistrationForm {
  return {
    event: EVENT,
    isOpen: true,
    closedReason: null,
    fields: [
      {
        id: "f1",
        key: "diet",
        fieldType: "text",
        labelPl: "Dieta",
        labelEn: "Diet",
        helpPl: "",
        helpEn: "",
        isRequired: true,
        options: [],
        sortOrder: 1,
      },
    ],
    tickets: [
      {
        id: "t1",
        key: "standard",
        namePl: "Standard",
        nameEn: "Standard",
        descriptionPl: "",
        descriptionEn: "",
        priceCents: 0,
        currency: "PLN",
        availability: "on_sale",
        seatsLeft: 10,
        requiresApproval: false,
        tierLocked: false,
        salesStartAt: null,
        salesEndAt: null,
        sortOrder: 1,
      },
    ],
    terms: [],
    ...overrides,
  } as RegistrationForm;
}

function renderForm() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PublicRegistrationForm slug="kongres" />
    </QueryClientProvider>,
  );
}

async function fillPerson(): Promise<void> {
  fireEvent.change(await screen.findByLabelText(/firstName/), { target: { value: "Anna" } });
  fireEvent.change(screen.getByLabelText(/lastName/), { target: { value: "Kowalska" } });
  fireEvent.change(screen.getByLabelText(/email/), { target: { value: "anna@example.org" } });
}

beforeEach(() => {
  fetchForm.mockReset();
  register.mockReset();
  cancel.mockReset();
});

describe("publiczny formularz zapisu", () => {
  it("zamkniete zapisy pokazuja POWOD z bazy, a nie pusty formularz", async () => {
    fetchForm.mockResolvedValue(
      openForm({ isOpen: false, closedReason: "sold_out", fields: [], tickets: [] }),
    );
    renderForm();
    expect(await screen.findByText("eventRegistration.closed.sold_out")).toBeTruthy();
    expect(screen.queryByLabelText(/firstName/)).toBeNull();
  });

  it("bez zgody obowiazkowej NIE wola event_register()", async () => {
    fetchForm.mockResolvedValue(openForm());
    renderForm();
    await fillPerson();
    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.submit" }));
    await waitFor(() =>
      expect(screen.getByText("eventRegistration.validation.dataProcessing")).toBeTruthy(),
    );
    expect(register).not.toHaveBeenCalled();
  });

  it("poprawny szkic jedzie do RPC z biletem, odpowiedzia i zgoda", async () => {
    fetchForm.mockResolvedValue(openForm());
    register.mockResolvedValue({
      registrationId: "r1",
      personId: null,
      status: "approved",
      decisionSource: null,
      waitlistPosition: null,
      ticketTypeId: "t1",
      qrToken: "qr",
      manageToken: "manage-secret",
    });
    renderForm();
    await fillPerson();
    fireEvent.change(screen.getByLabelText(/Dieta/), { target: { value: "wegetarianska" } });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /eventRegistration.consents.dataProcessing/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "eventRegistration.actions.submit" }));

    await waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    const payload = register.mock.calls[0]?.[0];
    expect(payload).toMatchObject({
      eventSlug: "kongres",
      firstName: "Anna",
      lastName: "Kowalska",
      email: "anna@example.org",
      // Jeden wybieralny bilet zaznacza sie sam - inaczej uczestnik dostawalby
      // odmowe `ticket_required` bez zadnej alternatywy do wyboru.
      ticketTypeId: "t1",
      consentDataProcessing: true,
      answers: [{ key: "diet", value: "wegetarianska" }],
    });

    // Klucz zarzadzania wraca RAZ - musi byc widoczny od razu po zapisie.
    expect(await screen.findByText("manage-secret")).toBeTruthy();
  });
});
