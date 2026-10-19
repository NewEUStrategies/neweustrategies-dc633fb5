// Formularz kontaktowy Gutenberga (`contact-form` z importu WordPressa) -
// MarketingContactFormView. Osobny od widgetu buildera (ContactFormView), ale
// pisze do TEGO SAMEGO utwardzonego server fn, więc dowodzimy kontraktu na
// tej granicy:
//   * payload: wartości przycięte, pola puste jako `undefined`, zgoda RODO
//     zapisana jako wpis w `consents` (dowód prawny), kontekst strony,
//   * brak wymaganej zgody NIE wysyła żądania i mówi to użytkownikowi,
//   * konwersja liczy się tylko po potwierdzeniu zapisu przez serwer,
//   * limity pól to wspólne `CONTACT_FIELD_LIMITS` (te same co walidator
//     serwera) - formularz nie pozwala wpisać więcej, niż serwer przyjmie.
//
// Granice: server fn (`useServerFn` -> sterowalna atrapa), analityka konwersji.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { CONTACT_FIELD_LIMITS } from "@/lib/forms/contactLimits";

const h = vi.hoisted(() => ({ submit: vi.fn(), track: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.submit }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: {} }));
vi.mock("@/lib/analytics/conversions", () => ({ trackFormConversion: h.track }));

import { ContactFormView } from "../MarketingContactFormView";

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
  h.track.mockReset();
  window.history.replaceState(null, "", "/kontakt?z=stopka");
});

afterEach(() => cleanup());

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillPl(): void {
  type("Imię i nazwisko", "  Jan Kowalski ");
  type("Adres e-mail", " jan@firma.pl ");
  type("Wiadomość", "  Treść zapytania  ");
}

const submitButton = () => screen.getByRole("button");
const sentPayload = () => h.submit.mock.calls[0][0].data as Record<string, unknown>;

describe("MarketingContactFormView - wysyłka", () => {
  it("wysyła przycięte wartości, zgodę jako wpis w consents i kontekst strony", async () => {
    render(<ContactFormView title="Napisz" showPhone lang="pl" />);
    fillPl();
    type("Telefon", "   ");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(sentPayload()).toEqual({
      name: "Jan Kowalski",
      email: "jan@firma.pl",
      phone: undefined,
      subject: undefined,
      message: "Treść zapytania",
      consent: true,
      lang: "pl",
      source: "/kontakt",
      pageUrl: window.location.href,
      consents: [
        {
          key: "rodo",
          text: "Wyrażam zgodę na przetwarzanie danych w celu udzielenia odpowiedzi.",
          given: true,
          lang: "pl",
        },
      ],
    });
  });

  it("BRAK wymaganej zgody: żądanie nie wychodzi, a komunikat jest ogłaszany", async () => {
    render(<ContactFormView lang="pl" />);
    fillPl();
    fireEvent.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Wymagana zgoda na przetwarzanie danych.",
    );
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("zgoda NIEwymagana: brak pola wyboru, consent=true i brak listy zgód (EN)", async () => {
    render(<ContactFormView requireConsent={false} showSubject lang="en" />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    type("Full name", "John");
    type("Email address", "john@x.test");
    type("Subject", " Offer ");
    type("Message", "Hello");
    fireEvent.click(submitButton());
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(sentPayload()).toMatchObject({
      consent: true,
      consents: undefined,
      subject: "Offer",
      lang: "en",
    });
  });

  it("SUKCES: komunikat z panelu, wyczyszczone pola i zgoda, konwersja policzona", async () => {
    render(<ContactFormView title="Kontakt" successMessage="Dzięki!" lang="pl" />);
    fillPl();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton());
    expect(await screen.findByRole("status")).toHaveTextContent("Dzięki!");
    expect(screen.getByLabelText("Imię i nazwisko")).toHaveValue("");
    expect(screen.getByLabelText("Wiadomość")).toHaveValue("");
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(h.track).toHaveBeenCalledWith({
      formId: "marketing_contact",
      formName: "Kontakt",
      lang: "pl",
    });
  });

  it("SUKCES bez własnego komunikatu używa kopii domyślnej (EN)", async () => {
    render(<ContactFormView requireConsent={false} lang="en" />);
    type("Full name", "John");
    type("Email address", "john@x.test");
    type("Message", "Hello");
    fireEvent.click(submitButton());
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Thanks - your message has been sent.",
    );
  });

  it("BŁĄD serwera: kopia widgetu zamiast surowego komunikatu, bez konwersji, wpisane dane zostają", async () => {
    h.submit.mockRejectedValueOnce(new Error("duplicate key value violates constraint"));
    render(<ContactFormView lang="pl" />);
    fillPl();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(submitButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Nie udało się wysłać wiadomości. Spróbuj ponownie.");
    expect(alert.textContent).not.toContain("duplicate");
    expect(h.track).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Imię i nazwisko")).toHaveValue("  Jan Kowalski ");
  });

  it("w trakcie wysyłki przycisk jest zablokowany i pokazuje stan", async () => {
    h.submit.mockImplementation(() => new Promise(() => {}));
    render(<ContactFormView requireConsent={false} submitLabel="Wyślij teraz" lang="pl" />);
    expect(submitButton()).toHaveTextContent("Wyślij teraz");
    fillPl();
    fireEvent.click(submitButton());
    await waitFor(() => expect(submitButton()).toBeDisabled());
    expect(submitButton()).toHaveTextContent("Wysyłanie...");
  });
});

describe("MarketingContactFormView - pola", () => {
  it("telefon jest domyślnie ukryty, temat domyślnie widoczny; tytuł i opis z panelu", () => {
    render(<ContactFormView title="Napisz do nas" description="Odpowiadamy w 24 h" lang="pl" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Napisz do nas");
    expect(screen.getByText("Odpowiadamy w 24 h")).toBeTruthy();
    expect(screen.queryByLabelText("Telefon")).toBeNull();
    expect(screen.getByLabelText("Temat")).toBeTruthy();
  });

  it("showSubject=false chowa temat; bez tytułu nie ma pustego nagłówka", () => {
    render(<ContactFormView showSubject={false} lang="pl" />);
    expect(screen.queryByLabelText("Temat")).toBeNull();
    expect(screen.queryByRole("heading")).toBeNull();
  });

  // NAPRAWIONE 2026-10-18: pola nie miały żadnego limitu długości, choć server
  // fn odrzuca wartości ponad `CONTACT_FIELD_LIMITS`. Wklejona długa wiadomość
  // kończyła się ogólnym „Nie udało się wysłać", bez wskazówki dlaczego.
  // Limity są wspólne z walidatorem serwera (zasada z AGENTS.md).
  it("każde pole ma limit długości równy wspólnemu limitowi walidatora serwera", () => {
    render(<ContactFormView showPhone showSubject lang="pl" />);
    const limits: Array<[string, number]> = [
      ["Imię i nazwisko", CONTACT_FIELD_LIMITS.name],
      ["Adres e-mail", CONTACT_FIELD_LIMITS.email],
      ["Telefon", CONTACT_FIELD_LIMITS.phone],
      ["Temat", CONTACT_FIELD_LIMITS.subject],
      ["Wiadomość", CONTACT_FIELD_LIMITS.message],
    ];
    for (const [label, limit] of limits) {
      expect(screen.getByLabelText(label), label).toHaveAttribute("maxLength", String(limit));
    }
  });
});
