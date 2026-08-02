// Regresja: 7 pól `*Placeholder` widgetu contact-form było martwych.
//
// Wrapper pływającej etykiety (`Field`) nadpisywał każde dziecko przez
// `cloneElement(el, { placeholder: " " })`, więc wartość wpisana w panelu nigdy
// nie docierała do kontrolki. Test pilnuje, że placeholder z ustawień jest w
// DOM, nie jest spacją, i że mechanizm unoszenia etykiety dalej działa.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FLOATING_LABEL_SPACER } from "@/components/ui/floating-input";

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => vi.fn() }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: {} }));

import { ContactFormView } from "../ContactFormView";

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
