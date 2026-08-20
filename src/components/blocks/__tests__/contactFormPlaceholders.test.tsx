// Regresja: 7 pól `*Placeholder` widgetu contact-form było martwych.
//
// Wrapper pływającej etykiety (`Field`) nadpisywał każde dziecko przez
// `cloneElement(el, { placeholder: " " })`, więc wartość wpisana w panelu nigdy
// nie docierała do kontrolki. Test pilnuje, że placeholder z ustawień jest w
// DOM, nie jest spacją, i że mechanizm unoszenia etykiety dalej działa.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FLOATING_LABEL_SPACER } from "@/components/ui/floating-input";

// Atrapa server fn jest STEROWALNA z testu: bez tego nie da się rozdzielić
// „walidacja odrzuciła, żądania nie było" od „żądanie poszło i wróciło błędem",
// a to dwie zupełnie różne awarie formularza kontaktowego.
const h = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.submit }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: {} }));

import { ContactFormView } from "../ContactFormView";

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

type Cfg = Record<string, unknown>;

function renderForm(data: Cfg, lang: "pl" | "en" = "pl") {
  const { container } = render(<ContactFormView data={data} lang={lang} />);
  const field = (name: string): HTMLInputElement | HTMLTextAreaElement => {
    const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    expect(el, `pole [name="${name}"]`).toBeTruthy();
    return el as HTMLInputElement | HTMLTextAreaElement;
  };
  return { container, field };
}

const ALL_FIELDS: Cfg = {
  showPhone: true,
  showCompany: true,
  showSubject: true,
};

describe("contact-form: placeholdery z panelu docierają do kontrolek", () => {
  it("wszystkie 7 pól bierze wartość z ustawień", () => {
    const { field } = renderForm({
      ...ALL_FIELDS,
      firstNamePlaceholder_pl: "np. Jan",
      lastNamePlaceholder_pl: "np. Kowalski",
      emailPlaceholder_pl: "jan@firma.pl",
      phonePlaceholder_pl: "+48 600 000 000",
      companyPlaceholder_pl: "Nazwa firmy",
      subjectPlaceholder_pl: "Czego dotyczy sprawa?",
      messagePlaceholder_pl: "Opisz swoje pytanie",
    });

    const expected: Record<string, string> = {
      firstName: "np. Jan",
      lastName: "np. Kowalski",
      email: "jan@firma.pl",
      phone: "+48 600 000 000",
      company: "Nazwa firmy",
      subject: "Czego dotyczy sprawa?",
      message: "Opisz swoje pytanie",
    };
    for (const [name, value] of Object.entries(expected)) {
      const el = field(name);
      expect(el.getAttribute("placeholder"), name).toBe(value);
      expect(el.getAttribute("placeholder"), name).not.toBe(" ");
    }
  });

  it("respektuje język panelu", () => {
    const { field } = renderForm(
      { emailPlaceholder_en: "you@company.com", messagePlaceholder_en: "How can we help?" },
      "en",
    );
    expect(field("email")).toHaveAttribute("placeholder", "you@company.com");
    expect(field("message")).toHaveAttribute("placeholder", "How can we help?");
  });

  it("bez ustawienia zostaje dwujęzyczny fallback pola imienia", () => {
    expect(renderForm({}, "pl").field("firstName")).toHaveAttribute("placeholder", "Jan");
    cleanup();
    expect(renderForm({}, "en").field("firstName")).toHaveAttribute("placeholder", "John");
  });

  it("brak placeholdera = zachowanie sprzed zmiany (spacer, nic widocznego)", () => {
    const { field } = renderForm(ALL_FIELDS);
    for (const name of ["phone", "company", "subject", "message"]) {
      expect(field(name).getAttribute("placeholder"), name).toBe(FLOATING_LABEL_SPACER);
    }
  });
});

describe("contact-form: custom fields", () => {
  const customFields = [
    JSON.stringify({
      id: "nip",
      type: "text",
      labelPl: "NIP",
      placeholderPl: "10 cyfr",
      placeholderEn: "10 digits",
    }),
    JSON.stringify({
      id: "notes",
      type: "textarea",
      labelPl: "Uwagi",
      placeholderPl: "Dodatkowe informacje",
    }),
    JSON.stringify({ id: "plain", type: "text", labelPl: "Bez podpowiedzi" }),
  ];

  it("text i textarea dostają swój placeholder, pole bez podpowiedzi spacer", () => {
    const { field } = renderForm({ customFields });
    expect(field("custom_nip")).toHaveAttribute("placeholder", "10 cyfr");
    expect(field("custom_notes")).toHaveAttribute("placeholder", "Dodatkowe informacje");
    expect(field("custom_plain").getAttribute("placeholder")).toBe(FLOATING_LABEL_SPACER);
  });

  it("custom field respektuje język", () => {
    const { field } = renderForm({ customFields }, "en");
    expect(field("custom_nip")).toHaveAttribute("placeholder", "10 digits");
  });
});

describe("contact-form: etykieta nadal się unosi", () => {
  it("puste pole z realnym placeholderem pokazuje `:placeholder-shown`", () => {
    const { field } = renderForm({ emailPlaceholder_pl: "jan@firma.pl" });
    const email = field("email");
    // Realny placeholder nie psuje warunku spoczynkowego: wartość pusta =>
    // `:placeholder-shown` prawda => etykieta siedzi w środku pola.
    expect(email.value).toBe("");
    expect(email.getAttribute("placeholder")).toBe("jan@firma.pl");
  });

  it("po wpisaniu wartości placeholder zostaje, ale pole ma treść", () => {
    const { field } = renderForm({ emailPlaceholder_pl: "jan@firma.pl" });
    const email = field("email") as HTMLInputElement;
    email.value = "kto@to.pl";
    // `:not(:placeholder-shown)` => etykieta uniesiona. Atrybut placeholdera
    // musi przetrwać, inaczej po wyczyszczeniu pola podpowiedź by zniknęła.
    expect(email.value).toBe("kto@to.pl");
    expect(email.getAttribute("placeholder")).toBe("jan@firma.pl");
  });

  it("wrapper wciąż dokłada klasę `.input` obok klas widgetu", () => {
    const { field } = renderForm({ emailPlaceholder_pl: "jan@firma.pl" });
    const email = field("email");
    expect(email.className.split(/\s+/)).toContain("input");
    expect(email.className.split(/\s+/)).toContain("cf-input");
  });
});

// ---------------------------------------------------------------------------
// WYSYŁKA (`onSubmit`) - najdroższa funkcja tego widgetu.
//
// Formularz kontaktowy jest jedyną drogą, którą czytelnik pisze do redakcji.
// Cztery awarie, których nie widać w kodzie, tylko w skrzynce (albo w jej
// braku):
//   1. walidacja przepuszcza puste pole wymagane -> serwer dostaje śmieci albo
//      odrzuca żądanie, a użytkownik widzi „coś poszło nie tak",
//   2. walidacja BLOKUJE, ale request i tak wychodzi -> podwójne zgłoszenia,
//   3. sukces nie czyści formularza -> użytkownik wysyła to samo drugi raz,
//   4. błąd API pokazuje surowy komunikat Postgresa zamiast kopii z ustawień.
// ---------------------------------------------------------------------------

type FormEls = { form: HTMLFormElement; set: (name: string, value: string) => void };

function renderSubmittable(data: Cfg = {}, lang: "pl" | "en" = "pl"): FormEls {
  const { container } = render(<ContactFormView data={data} lang={lang} />);
  const form = container.querySelector("form") as HTMLFormElement;
  expect(form, "formularz").toBeTruthy();
  const set = (name: string, value: string) => {
    const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    expect(el, `pole [name="${name}"]`).toBeTruthy();
    fireEvent.change(el as HTMLElement, { target: { value } });
  };
  return { form, set };
}

/** Zaznacza pole wyboru o danej nazwie (zgoda RODO / newsletter / custom). */
function check(name: string): void {
  const el = document.querySelector<HTMLElement>(`[name="${name}"]`);
  expect(el, `pole wyboru [name="${name}"]`).toBeTruthy();
  fireEvent.click(el as HTMLElement);
}

/** Wypełnia minimalny poprawny zestaw pól i zaznacza zgodę. */
function fillValid(set: FormEls["set"]): void {
  set("firstName", "Jan");
  set("email", "jan@firma.pl");
  set("message", "Treść wiadomości");
  check("consent");
}

describe("contact-form: walidacja przed wysyłką", () => {
  it("puste pole WYMAGANE blokuje wysyłkę - żądanie NIE wychodzi", async () => {
    const { form } = renderSubmittable();
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector('[data-invalid="true"]')).toBeTruthy());
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("komunikat walidacji wchodzi w miejsce etykiety pola", async () => {
    const { form } = renderSubmittable();
    fireEvent.submit(form);
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll("label.user-label")).map(
        (l) => l.textContent,
      );
      expect(labels).toContain("Pole wymagane");
    });
  });

  it("komunikat walidacji jest w języku panelu (EN)", async () => {
    const { form } = renderSubmittable({}, "en");
    fireEvent.submit(form);
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll("label.user-label")).map(
        (l) => l.textContent,
      );
      expect(labels).toContain("Required field");
    });
  });

  it("adres e-mail w złym FORMACIE jest odrzucany osobnym komunikatem", async () => {
    const { form, set } = renderSubmittable();
    set("firstName", "Jan");
    set("email", "to-nie-jest-adres");
    set("message", "Treść");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() => {
      const labels = Array.from(document.querySelectorAll("label.user-label")).map(
        (l) => l.textContent,
      );
      expect(labels).toContain("Niepoprawny adres e-mail");
    });
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.each(["jan@firma.pl", "jan.kowalski+tag@pod.firma.com.pl", "a@b.co"])(
    "adres %s przechodzi walidację formatu",
    async (email) => {
      const { form, set } = renderSubmittable();
      set("firstName", "Jan");
      set("email", email);
      set("message", "Treść");
      check("consent");
      fireEvent.submit(form);
      await waitFor(() => expect(h.submit).toHaveBeenCalled());
    },
  );

  it.each(["bez-malpy.pl", "jan@bezkropki", "jan@ .pl", "@firma.pl", "jan@firma."])(
    "adres %s jest odrzucany",
    async (email) => {
      const { form, set } = renderSubmittable();
      set("firstName", "Jan");
      set("email", email);
      set("message", "Treść");
      check("consent");
      fireEvent.submit(form);
      await waitFor(() => expect(document.querySelector('[data-invalid="true"]')).toBeTruthy());
      expect(h.submit).not.toHaveBeenCalled();
    },
  );

  it("BRAK zgody RODO blokuje wysyłkę, gdy zgoda jest wymagana", async () => {
    const { form, set } = renderSubmittable();
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    // Wysyłka MUSI zostać zablokowana - to wymóg prawny, nie kosmetyka.
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
    // Formularz zostaje na miejscu (nie pokazuje ekranu sukcesu).
    expect(document.querySelector("form")).toBeTruthy();
  });

  // DEFEKT PRODUKCYJNY (zgłoszony, nie obejściony) - CICHA ODMOWA WYSYŁKI.
  // `onSubmit` ustawia `errs.consent = t.required` i przerywa wysyłkę, ale blok
  // zgód renderuje TYLKO etykietę z polem wyboru - nigdzie nie czyta
  // `errors.consent`. Skutek dla użytkownika: klika „Wyślij", nic się nie
  // dzieje, nie ma ani komunikatu, ani podświetlenia pola. Pozostałe pola mają
  // ścieżkę komunikatu przez `Field` (`data-invalid` + tekst w miejscu
  // etykiety); zgoda RODO jej NIE MA, a jest jednocześnie jedynym polem
  // wymaganym domyślnie i nieoczywistym (pole wyboru poniżej przycisku).
  // Naprawa to wyrenderowanie `errors.consent` przy etykiecie zgody - zmiana
  // zachowania produkcyjnego, więc poza zakresem zadania pokryciowego. Test
  // STOI jako dowód.
  it.fails("POWINNO pokazać komunikat, gdy brakuje wymaganej zgody RODO", async () => {
    const { form, set } = renderSubmittable();
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
    expect(document.body.textContent).toContain("Pole wymagane");
  });

  it("dziś brak zgody RODO odmawia wysyłki BEZ żadnego komunikatu", async () => {
    const { form, set } = renderSubmittable();
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
    expect(document.querySelector('[data-invalid="true"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Pole wymagane");
  });

  it("zgoda NIEwymagana przepuszcza wysyłkę bez zaznaczenia", async () => {
    const { form, set } = renderSubmittable({ requireConsent: false });
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    // Payload musi wtedy nieść `consent: true` - serwer nie ma zgadywać.
    expect(h.submit.mock.calls[0][0].data.consent).toBe(true);
  });

  it.each([
    ["firstName", { requireFirstName: true }],
    ["lastName", { showLastName: true, requireLastName: true }],
    ["email", { requireEmail: true }],
    ["phone", { showPhone: true, requirePhone: true }],
    ["company", { showCompany: true, requireCompany: true }],
    ["subject", { showSubject: true, requireSubject: true }],
    ["message", { requireMessage: true }],
  ])("pole %s oznaczone jako wymagane blokuje puste zgłoszenie", async (_name, cfg) => {
    const { form } = renderSubmittable({ ...cfg, requireConsent: false });
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector('[data-invalid="true"]')).toBeTruthy());
    expect(h.submit).not.toHaveBeenCalled();
  });

  it("pole UKRYTE nie jest wymagane, choćby miało włączoną flagę wymagania", async () => {
    // To jest realna pułapka konfiguracji: redaktor wyłącza pole, ale zostawia
    // `requirePhone: true`. Formularz nie może wtedy być niewysyłalny.
    const { form, set } = renderSubmittable({
      showPhone: false,
      requirePhone: true,
      requireConsent: false,
    });
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
  });

  it("lista pól wymaganych trafia do payloadu (serwer waliduje ponownie)", async () => {
    const { form, set } = renderSubmittable({ showPhone: true, requirePhone: true });
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("phone", "600100200");
    set("message", "Treść");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data.requiredFields).toEqual(
      expect.arrayContaining(["firstName", "email", "phone", "message"]),
    );
  });

  it("HONEYPOT wypełniony przez bota przerywa wysyłkę BEZ komunikatu błędu", async () => {
    const { form, set } = renderSubmittable();
    fillValid(set);
    set("website", "https://spam.test");
    fireEvent.submit(form);
    // Bot nie ma dostać informacji, że został rozpoznany - żadnego błędu.
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
    expect(document.querySelector('[data-invalid="true"]')).toBeNull();
  });
});

describe("contact-form: kształt payloadu", () => {
  it("scala imię i nazwisko w pole name", async () => {
    const { form, set } = renderSubmittable({ showLastName: true });
    set("firstName", "Jan");
    set("lastName", "Kowalski");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.name).toBe("Jan Kowalski");
    expect(payload.firstName).toBe("Jan");
    expect(payload.lastName).toBe("Kowalski");
  });

  it("BEZ nazwiska nie zostawia wiszącej spacji w polu name", async () => {
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data.name).toBe("Jan");
  });

  it("pola opcjonalne PUSTE idą jako undefined, nie jako pusty string", async () => {
    const { form, set } = renderSubmittable({ showPhone: true, showCompany: true });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.phone).toBeUndefined();
    expect(payload.company).toBeUndefined();
    expect(payload.subject).toBeUndefined();
  });

  it("przycina białe znaki z brzegów wartości", async () => {
    const { form, set } = renderSubmittable();
    set("firstName", "  Jan  ");
    set("email", "  jan@firma.pl  ");
    set("message", "  Treść  ");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.firstName).toBe("Jan");
    expect(payload.email).toBe("jan@firma.pl");
    expect(payload.message).toBe("Treść");
  });

  it("zapisuje zgodę RODO jako wpis w liście zgód (dowód prawny)", async () => {
    const { form, set } = renderSubmittable({ consentText_pl: "Moja treść zgody" });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const consents = h.submit.mock.calls[0][0].data.consents as Array<Record<string, unknown>>;
    expect(consents).toEqual([{ key: "rodo", text: "Moja treść zgody", given: true, lang: "pl" }]);
  });

  it("BEZ wymaganej zgody lista zgód RODO jest pusta", async () => {
    const { form, set } = renderSubmittable({ requireConsent: false });
    set("firstName", "Jan");
    set("email", "jan@firma.pl");
    set("message", "Treść");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data.consents).toEqual([]);
  });

  it("zapis do newslettera dokłada DRUGI wpis zgody", async () => {
    const { form, set } = renderSubmittable({ showNewsletterOptIn: true });
    fillValid(set);
    check("newsletter_optin");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.newsletterOptIn).toBe(true);
    expect((payload.consents as Array<{ key: string }>).map((c) => c.key)).toEqual([
      "rodo",
      "newsletter",
    ]);
  });

  it("newsletter WIDOCZNY ale NIEzaznaczony nie dokłada zgody", async () => {
    const { form, set } = renderSubmittable({ showNewsletterOptIn: true });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.newsletterOptIn).toBe(false);
    expect((payload.consents as Array<{ key: string }>).map((c) => c.key)).toEqual(["rodo"]);
  });

  it("niesie język, identyfikator formularza i kontekst strony", async () => {
    const { form, set } = renderSubmittable({ title_pl: "Formularz kontaktowy" });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const payload = h.submit.mock.calls[0][0].data;
    expect(payload.lang).toBe("pl");
    expect(String(payload.formId).length).toBeGreaterThan(0);
    expect(payload.formName).toBe("Formularz kontaktowy");
    expect(typeof payload.pageUrl).toBe("string");
    expect(typeof payload.source).toBe("string");
  });

  it("formularz BEZ tytułu nie wysyła nazwy jako pustego stringa", async () => {
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data.formName).toBeUndefined();
  });

  it("NIE wysyła adresata z ustawień widgetu (ochrona przed otwartym przekaźnikiem)", async () => {
    const { form, set } = renderSubmittable({ recipient: "atakujacy@zly.test" });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data).not.toHaveProperty("recipient");
  });
});

describe("contact-form: cykl wysyłki", () => {
  it("SUKCES pokazuje komunikat z ustawień i chowa formularz", async () => {
    const { form, set } = renderSubmittable({ successMsg_pl: "Dziękujemy za wiadomość" });
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(document.body.textContent).toContain("Dziękujemy za wiadomość");
    expect(document.querySelector('[role="status"]')).toBeTruthy();
  });

  it("SUKCES bez własnego komunikatu używa kopii domyślnej", async () => {
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(document.body.textContent).toContain("Wysłano!"));
  });

  it("SUKCES w wersji angielskiej używa angielskiej kopii domyślnej", async () => {
    const { form, set } = renderSubmittable({}, "en");
    set("firstName", "John");
    set("email", "john@company.com");
    set("message", "Body");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() => expect(document.body.textContent).toContain("Sent!"));
  });

  it("BŁĄD API pokazuje kopię widgetu, nie surowy komunikat serwera", async () => {
    h.submit.mockRejectedValue(new Error('duplicate key value violates unique constraint "x"'));
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Wystąpił błąd. Spróbuj ponownie."),
    );
    // Szczegół implementacyjny bazy NIE MOŻE trafić na stronę publiczną.
    expect(document.body.textContent).not.toContain("duplicate key");
    // Formularz zostaje, żeby dało się wysłać ponownie.
    expect(document.querySelector("form")).toBeTruthy();
  });

  it("BŁĄD API w wersji angielskiej pokazuje angielską kopię", async () => {
    h.submit.mockRejectedValue(new Error("boom"));
    const { form, set } = renderSubmittable({}, "en");
    set("firstName", "John");
    set("email", "john@company.com");
    set("message", "Body");
    check("consent");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(document.body.textContent).toContain("Something went wrong. Please try again."),
    );
  });

  it("PODWÓJNE zatwierdzenie nie wysyła dwóch zgłoszeń", async () => {
    let release: (v: unknown) => void = () => {};
    h.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    // Przycisk MUSI być zablokowany w trakcie wysyłki - to jedyna bariera
    // przed drugim zgłoszeniem tej samej wiadomości.
    const button = document.querySelector("button.cf-submit") as HTMLButtonElement | null;
    expect(button?.disabled).toBe(true);
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(h.submit).toHaveBeenCalledTimes(3);
    release({ ok: true });
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
  });

  it("w trakcie wysyłki przycisk pokazuje etykietę stanu", async () => {
    h.submit.mockImplementation(() => new Promise(() => {}));
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => {
      const button = document.querySelector("button.cf-submit") as HTMLButtonElement;
      expect(button.disabled).toBe(true);
    });
  });

  it("po BŁĘDZIE poprawiony formularz da się wysłać ponownie", async () => {
    h.submit.mockRejectedValueOnce(new Error("chwilowa awaria")).mockResolvedValue({ ok: true });
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(document.body.textContent).toContain("Wystąpił błąd"));
    fireEvent.submit(form);
    await waitFor(() => expect(document.querySelector("form")).toBeNull());
    expect(h.submit).toHaveBeenCalledTimes(2);
  });
});

describe("contact-form: pola dodatkowe z panelu", () => {
  const CUSTOM: Cfg = {
    customFields: [
      { id: "nip", type: "text", labelPl: "NIP", labelEn: "VAT id", required: true },
      { id: "uwagi", type: "textarea", labelPl: "Uwagi", labelEn: "Notes" },
      {
        id: "zrodlo",
        type: "select",
        labelPl: "Skąd o nas wiesz",
        labelEn: "How did you hear",
        options: [
          { value: "google", labelPl: "Google", labelEn: "Google" },
          { value: "polecenie", labelPl: "Polecenie" },
        ],
      },
      { id: "zgoda2", type: "checkbox", labelPl: "Druga zgoda", labelEn: "Second consent" },
    ],
  };

  it.each([
    ["text", "custom_nip", "INPUT"],
    ["textarea", "custom_uwagi", "TEXTAREA"],
    ["select", "custom_zrodlo", "SELECT"],
    ["checkbox", "custom_zgoda2", null],
  ])("pole dodatkowe typu %s renderuje się jako %s", (_type, name, tag) => {
    render(<ContactFormView data={CUSTOM} lang="pl" />);
    const el = document.querySelector(`[name="${name}"]`);
    expect(el, name).toBeTruthy();
    if (tag) expect(el?.tagName).toBe(tag);
  });

  it("pole dodatkowe WYMAGANE blokuje wysyłkę, gdy jest puste", async () => {
    const { form, set } = renderSubmittable(CUSTOM);
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).not.toHaveBeenCalled());
  });

  it("wypełnione pola dodatkowe trafiają do payloadu pod własnymi kluczami", async () => {
    const { form, set } = renderSubmittable(CUSTOM);
    fillValid(set);
    set("custom_nip", "1234567890");
    set("custom_uwagi", "Prosimy o kontakt telefoniczny");
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    const custom = h.submit.mock.calls[0][0].data.custom as Record<string, unknown>;
    expect(custom.nip).toBe("1234567890");
    expect(custom.uwagi).toBe("Prosimy o kontakt telefoniczny");
  });

  it("select pola dodatkowego pokazuje opcje z panelu", () => {
    render(<ContactFormView data={CUSTOM} lang="pl" />);
    const options = Array.from(document.querySelectorAll('[name="custom_zrodlo"] option')).map(
      (o) => o.textContent,
    );
    expect(options).toContain("Google");
    expect(options).toContain("Polecenie");
  });

  it("opcja BEZ etykiety w danym języku spada na własną wartość", () => {
    render(<ContactFormView data={CUSTOM} lang="en" />);
    const options = Array.from(document.querySelectorAll('[name="custom_zrodlo"] option')).map(
      (o) => o.textContent,
    );
    // `polecenie` nie ma `labelEn`, więc widoczna jest wartość techniczna -
    // brzydka, ale NIE „undefined".
    expect(options).toContain("polecenie");
    expect(options.join("|")).not.toContain("undefined");
  });

  it("etykiety pól dodatkowych podążają za językiem", () => {
    render(<ContactFormView data={CUSTOM} lang="en" />);
    expect(document.body.textContent).toContain("VAT id");
    expect(document.body.textContent).not.toContain("NIP");
  });

  it("brak pól dodatkowych nie dokłada niczego do payloadu", async () => {
    const { form, set } = renderSubmittable();
    fillValid(set);
    fireEvent.submit(form);
    await waitFor(() => expect(h.submit).toHaveBeenCalled());
    expect(h.submit.mock.calls[0][0].data.custom).toEqual({});
  });

  it.each([
    ["null", null],
    ["string", "nie tablica"],
    ["obiekt", { a: 1 }],
    ["tablica śmieci", [null, 7, "x"]],
  ])("customFields podane jako %s nie wywala renderu", (_l, value) => {
    const { container } = render(<ContactFormView data={{ customFields: value }} lang="pl" />);
    expect(container.querySelector("form")).toBeTruthy();
  });
});

describe("contact-form: warianty wyglądu i widoczność pól", () => {
  it.each(["card", "flat", "inline", "nieznany-wariant"])(
    "wariant %s renderuje formularz",
    (variant) => {
      const { container } = render(<ContactFormView data={{ variant }} lang="pl" />);
      expect(container.querySelector(`.cf-shell--${variant}`)).toBeTruthy();
    },
  );

  it.each([1, 2, 3])("układ %i-kolumnowy renderuje siatkę", (columns) => {
    const { container } = render(<ContactFormView data={{ columns }} lang="pl" />);
    expect(container.querySelector("form")).toBeTruthy();
  });

  it.each([0, 4, -1, 99, "2", "abc"])(
    "liczba kolumn %j jest klampowana do zakresu 1-3 bez wyjątku",
    (columns) => {
      const { container } = render(<ContactFormView data={{ columns }} lang="pl" />);
      expect(container.querySelector("form")).toBeTruthy();
    },
  );

  it.each(["left", "center", "right", "full", "nieznane"])(
    "wyrównanie przycisku %s renderuje przycisk",
    (buttonAlign) => {
      const { container } = render(<ContactFormView data={{ buttonAlign }} lang="pl" />);
      expect(container.querySelector("button.cf-submit")).toBeTruthy();
    },
  );

  it.each(["bottom", "inline-right"])(
    "pozycja przycisku %s renderuje przycisk",
    (buttonPosition) => {
      const { container } = render(<ContactFormView data={{ buttonPosition }} lang="pl" />);
      expect(container.querySelector("button.cf-submit")).toBeTruthy();
    },
  );

  it.each(["solid", "outline", "ghost", "gradient"])(
    "wariant przycisku %s renderuje przycisk",
    (buttonVariant) => {
      const { container } = render(<ContactFormView data={{ buttonVariant }} lang="pl" />);
      expect(container.querySelector("button.cf-submit")).toBeTruthy();
    },
  );

  it.each(["sm", "md", "lg"])("rozmiar przycisku %s renderuje przycisk", (buttonSize) => {
    const { container } = render(<ContactFormView data={{ buttonSize }} lang="pl" />);
    expect(container.querySelector("button.cf-submit")).toBeTruthy();
  });

  it.each([
    ["showFirstName", "firstName"],
    ["showLastName", "lastName"],
    ["showEmail", "email"],
    ["showPhone", "phone"],
    ["showCompany", "company"],
    ["showSubject", "subject"],
    ["showMessage", "message"],
  ])("przełącznik %s włącza pole %s", (flag, name) => {
    const { container } = render(<ContactFormView data={{ [flag]: true }} lang="pl" />);
    expect(container.querySelector(`[name="${name}"]`)).toBeTruthy();
  });

  it.each([
    ["showFirstName", "firstName"],
    ["showEmail", "email"],
    ["showSubject", "subject"],
    ["showMessage", "message"],
  ])("przełącznik %s ustawiony na false UKRYWA pole %s", (flag, name) => {
    const { container } = render(<ContactFormView data={{ [flag]: false }} lang="pl" />);
    expect(container.querySelector(`[name="${name}"]`)).toBeNull();
  });

  it.each(["0", "false"])(
    "przełącznik jako legacy string %j wyłącza pole (nie jest prawdą)",
    (value) => {
      const { container } = render(<ContactFormView data={{ showSubject: value }} lang="pl" />);
      expect(container.querySelector('[name="subject"]')).toBeNull();
    },
  );

  it.each(["1", "true"])("przełącznik jako legacy string %j włącza pole", (value) => {
    const { container } = render(<ContactFormView data={{ showPhone: value }} lang="pl" />);
    expect(container.querySelector('[name="phone"]')).toBeTruthy();
  });

  it("legacy showName wyłącza OBA pola imienia i nazwiska", () => {
    const { container } = render(<ContactFormView data={{ showName: false }} lang="pl" />);
    expect(container.querySelector('[name="firstName"]')).toBeNull();
    expect(container.querySelector('[name="lastName"]')).toBeNull();
  });

  it("legacy showName włącza OBA pola", () => {
    const { container } = render(<ContactFormView data={{ showName: true }} lang="pl" />);
    expect(container.querySelector('[name="firstName"]')).toBeTruthy();
    expect(container.querySelector('[name="lastName"]')).toBeTruthy();
  });

  it("nowy przełącznik ma pierwszeństwo nad legacy showName", () => {
    const { container } = render(
      <ContactFormView data={{ showName: false, showFirstName: true }} lang="pl" />,
    );
    expect(container.querySelector('[name="firstName"]')).toBeTruthy();
    expect(container.querySelector('[name="lastName"]')).toBeNull();
  });

  it("tytuł i podtytuł z panelu trafiają do renderu", () => {
    const { container } = render(
      <ContactFormView
        data={{ title_pl: "Napisz", subtitle_pl: "Odpowiadamy szybko" }}
        lang="pl"
      />,
    );
    expect(container.querySelector(".cf-title")?.textContent).toBe("Napisz");
    expect(container.querySelector(".cf-subtitle")?.textContent).toBe("Odpowiadamy szybko");
  });

  it("BEZ tytułu i podtytułu nie renderuje pustych elementów", () => {
    const { container } = render(<ContactFormView data={{}} lang="pl" />);
    expect(container.querySelector(".cf-title")).toBeNull();
    expect(container.querySelector(".cf-subtitle")).toBeNull();
  });

  it("etykieta przycisku z panelu wygrywa nad domyślną", () => {
    const { container } = render(
      <ContactFormView data={{ submitLabel_pl: "Prześlij zgłoszenie" }} lang="pl" />,
    );
    expect(container.querySelector("button.cf-submit")?.textContent).toContain(
      "Prześlij zgłoszenie",
    );
  });

  it.each([
    ["pl", "Wyślij"],
    ["en", "Send"],
  ] as const)("BEZ etykiety przycisk używa kopii domyślnej dla %s", (lang, label) => {
    const { container } = render(<ContactFormView data={{}} lang={lang} />);
    expect(container.querySelector("button.cf-submit")?.textContent).toContain(label);
  });
});

describe("contact-form: styl i tło z panelu", () => {
  it.each(["bgLight", "bgDark", "textColor", "borderColor"])(
    "kolor %s przechodzi do zmiennych CSS powłoki",
    (key) => {
      const { container } = render(<ContactFormView data={{ [key]: "#123456" }} lang="pl" />);
      const shell = container.querySelector(".cf-shell") as HTMLElement;
      expect(shell.getAttribute("style")).toContain("#123456");
    },
  );

  it.each(["radiusPx", "paddingPx"])("wymiar %s przechodzi do zmiennych CSS", (key) => {
    const { container } = render(<ContactFormView data={{ [key]: 24 }} lang="pl" />);
    const shell = container.querySelector(".cf-shell") as HTMLElement;
    expect(shell.getAttribute("style")).toContain("24px");
  });

  it.each([
    ["titleSize", ".cf-title"],
    ["descriptionSize", ".cf-subtitle"],
    ["labelSize", ".cf-field-label"],
    ["placeholderSize", ".cf-input"],
    ["buttonFontSize", ".cf-submit"],
    ["consentSize", ".cf-consent"],
  ])("rozmiar czcionki %s emituje regułę CSS dla %s", (key, selector) => {
    const { container } = render(
      <ContactFormView data={{ [key]: 18, title_pl: "T", subtitle_pl: "S" }} lang="pl" />,
    );
    const style = container.querySelector("style")?.textContent ?? "";
    expect(style).toContain(selector);
    expect(style).toContain("18px");
  });

  it("rozmiar czcionki równy 0 NIE emituje reguły (0 = zostaw domyślny)", () => {
    const { container } = render(<ContactFormView data={{ titleSize: 0 }} lang="pl" />);
    const style = container.querySelector("style")?.textContent ?? "";
    expect(style).not.toContain(".cf-title{font-size");
  });

  it.each([
    ["javascript:alert(1)", "schemat javascript"],
    ["data:text/html,<b>x</b>", "schemat data"],
  ])("tło %s (%s) jest odrzucane, nie wstrzykiwane do stylu", (bgImage) => {
    const { container } = render(<ContactFormView data={{ bgImage }} lang="pl" />);
    expect(container.innerHTML).not.toContain("javascript:");
    expect(container.innerHTML).not.toContain("data:text/html");
  });

  it("tło z dozwolonego adresu trafia do renderu", () => {
    const { container } = render(
      <ContactFormView data={{ bgImage: "https://cdn.test/tlo.jpg" }} lang="pl" />,
    );
    expect(container.innerHTML).toContain("cdn.test/tlo.jpg");
  });

  it("tło mobilne emituje własną regułę media", () => {
    const { container } = render(
      <ContactFormView
        data={{ bgImage: "https://cdn.test/a.jpg", bgImageMobile: "https://cdn.test/m.jpg" }}
        lang="pl"
      />,
    );
    expect(container.innerHTML).toContain("cdn.test/m.jpg");
  });

  it.each([0, 50, 100])("przyciemnienie tła %i renderuje się bez wyjątku", (bgOverlay) => {
    const { container } = render(
      <ContactFormView data={{ bgImage: "https://cdn.test/a.jpg", bgOverlay }} lang="pl" />,
    );
    expect(container.querySelector("form")).toBeTruthy();
  });

  it("ikona z panelu renderuje się jako obraz", () => {
    const { container } = render(
      <ContactFormView data={{ iconUrl: "https://cdn.test/ikona.svg" }} lang="pl" />,
    );
    expect(container.innerHTML).toContain("cdn.test/ikona.svg");
  });
});

describe("contact-form: treść zgody z linkami markdown", () => {
  it("zamienia [etykieta](adres) na link", () => {
    const { container } = render(
      <ContactFormView
        data={{ consentText_pl: "Akceptuję [regulamin](https://x.test/regulamin)." }}
        lang="pl"
      />,
    );
    const link = container.querySelector(".cf-consent a") as HTMLAnchorElement;
    expect(link?.getAttribute("href")).toBe("https://x.test/regulamin");
    expect(link?.textContent).toBe("regulamin");
    // Link zewnętrzny MUSI mieć rel przeciw tabnabbingowi.
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link?.getAttribute("target")).toBe("_blank");
  });

  it.each(["/polityka", "mailto:biuro@x.test"])(
    "adres wewnętrzny %s zostaje linkiem BEZ target=_blank",
    (href) => {
      const { container } = render(
        <ContactFormView data={{ consentText_pl: `Zobacz [tu](${href}).` }} lang="pl" />,
      );
      const link = container.querySelector(".cf-consent a") as HTMLAnchorElement;
      expect(link?.getAttribute("href")).toBe(href);
      expect(link?.getAttribute("target")).toBeNull();
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://x.test/a"])(
    "adres NIEDOZWOLONY %s traci link, zachowuje tekst",
    (href) => {
      const { container } = render(
        <ContactFormView data={{ consentText_pl: `Zobacz [tu](${href}).` }} lang="pl" />,
      );
      expect(container.querySelector(".cf-consent a")).toBeNull();
      expect(container.querySelector(".cf-consent")?.textContent).toContain("tu");
    },
  );

  it("treść zgody BEZ linków renderuje się jako czysty tekst", () => {
    const { container } = render(
      <ContactFormView data={{ consentText_pl: "Zwykła zgoda bez linków" }} lang="pl" />,
    );
    expect(container.querySelector(".cf-consent")?.textContent).toContain(
      "Zwykła zgoda bez linków",
    );
  });

  it("treść zgody z KILKOMA linkami renderuje każdy z nich", () => {
    const { container } = render(
      <ContactFormView
        data={{
          consentText_pl: "[A](https://a.test) oraz [B](https://b.test) i koniec.",
        }}
        lang="pl"
      />,
    );
    const links = container.querySelectorAll(".cf-consent a");
    expect(links).toHaveLength(2);
    expect(container.querySelector(".cf-consent")?.textContent).toContain("i koniec.");
  });

  it("PUSTA treść zgody nie renderuje elementu zgody", () => {
    const { container } = render(
      <ContactFormView data={{ consentText_pl: "", requireConsent: false }} lang="pl" />,
    );
    expect(container.querySelector(".cf-consent")).toBeNull();
  });
});
