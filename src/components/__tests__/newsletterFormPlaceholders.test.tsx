// Regresja: 4 pola `*Placeholder` widgetu newslettera były martwe.
//
// `FieldWrap` (wrapper pływającej etykiety) klonował dziecko z
// `placeholder: " "`, kasując wartość wpisaną w panelu buildera. Test pilnuje,
// że placeholder z ustawień jest w DOM, nie jest spacją, i że pole bez
// podpowiedzi zachowuje się jak przed zmianą.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { FLOATING_LABEL_SPACER } from "@/components/ui/floating-input";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({}),
    channel: () => {
      const ch: { on: () => typeof ch; subscribe: () => typeof ch } = {
        on: () => ch,
        subscribe: () => ch,
      };
      return ch;
    },
    removeChannel: () => {},
  },
}));
vi.mock("@/lib/i18n-public", () => ({}));
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));
const makeChain = () => ({
  middleware: () => makeChain(),
  inputValidator: () => makeChain(),
  handler: () => ({}),
});
vi.mock("@tanstack/react-start", () => ({
  useServerFn: () => vi.fn(),
  createMiddleware: () => () => vi.fn(),
  createServerFn: () => makeChain(),
}));
vi.mock("@/lib/newsletter.functions", () => ({ subscribeToNewsletter: {} }));
vi.mock("@/lib/builder/modeContext", () => ({ useBuilderMode: () => null }));
vi.mock("@/components/newsletter/NewsletterDocRenderer", () => ({
  NewsletterDocRenderer: () => null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.defaultValue === "string" ? opts.defaultValue : key,
  }),
}));
vi.mock("@/hooks/useNewsletterSettings", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useNewsletterSettings")>(
    "@/hooks/useNewsletterSettings",
  );
  return {
    ...actual,
    useNewsletterSettings: () => ({
      data: { ...actual.defaultNewsletterSettings(), mode: "inline", inline_doc: null },
    }),
  };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NewsletterForm } from "../NewsletterForm";

afterEach(() => cleanup());

type Cfg = Record<string, unknown>;

function renderForm(widgetConfig: Cfg, lang: "pl" | "en" = "pl") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <NewsletterForm lang={lang} widgetConfig={widgetConfig} />
    </QueryClientProvider>,
  );
  const byType = (type: string): HTMLInputElement => {
    const el = container.querySelector<HTMLInputElement>(`input[type="${type}"]`);
    expect(el, `input[type="${type}"]`).toBeTruthy();
    return el as HTMLInputElement;
  };
  const byName = (name: string): HTMLInputElement | HTMLTextAreaElement => {
    const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    expect(el, `pole [name="${name}"]`).toBeTruthy();
    return el as HTMLInputElement | HTMLTextAreaElement;
  };
  const texts = (): HTMLInputElement[] =>
    Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
  return { container, byType, byName, texts };
}

const EXTRAS: Cfg = { showFirstName: true, showLastName: true, showCompany: true };

describe("newsletter: placeholdery z panelu docierają do kontrolek", () => {
  it("imię / nazwisko / firma / e-mail biorą wartość z ustawień", () => {
    const { texts, byType } = renderForm({
      ...EXTRAS,
      firstNamePlaceholder_pl: "np. Jan",
      lastNamePlaceholder_pl: "np. Kowalski",
      companyPlaceholder_pl: "Nazwa firmy",
      emailPlaceholder_pl: "jan@firma.pl",
    });

    const [firstName, lastName, company] = texts();
    expect(firstName).toHaveAttribute("placeholder", "np. Jan");
    expect(lastName).toHaveAttribute("placeholder", "np. Kowalski");
    expect(company).toHaveAttribute("placeholder", "Nazwa firmy");
    expect(byType("email")).toHaveAttribute("placeholder", "jan@firma.pl");

    for (const el of [firstName, lastName, company, byType("email")]) {
      expect(el.getAttribute("placeholder")).not.toBe(" ");
    }
  });

  it("respektuje język panelu", () => {
    const { byType } = renderForm({ ...EXTRAS, emailPlaceholder_en: "you@company.com" }, "en");
    expect(byType("email")).toHaveAttribute("placeholder", "you@company.com");
  });

  it("layout kompaktowy (bez dodatkowych pól) też dostaje placeholder e-maila", () => {
    const { byType } = renderForm({ emailPlaceholder_pl: "jan@firma.pl" });
    expect(byType("email")).toHaveAttribute("placeholder", "jan@firma.pl");
    // Pole "imię i nazwisko" w tym layoucie nie ma ustawienia placeholdera,
    // więc zostaje spacer i etykieta spoczywa w środku pola.
    expect(byType("text").getAttribute("placeholder")).toBe(FLOATING_LABEL_SPACER);
  });

  it("bez ustawień wchodzi domyślny tekst i18n, nigdy spacja", () => {
    const { byType } = renderForm(EXTRAS);
    const email = byType("email");
    expect(email.getAttribute("placeholder")).toBe("newsletterForm.emailPlaceholder");
    expect(email.getAttribute("placeholder")).not.toBe(" ");
  });
});

describe("newsletter: custom fields", () => {
  const customFields = [
    JSON.stringify({
      id: "role",
      type: "text",
      labelPl: "Stanowisko",
      placeholderPl: "np. Dyrektor",
      placeholderEn: "e.g. Director",
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
    const { byName } = renderForm({ customFields });
    expect(byName("custom_role")).toHaveAttribute("placeholder", "np. Dyrektor");
    expect(byName("custom_notes")).toHaveAttribute("placeholder", "Dodatkowe informacje");
    expect(byName("custom_plain").getAttribute("placeholder")).toBe(FLOATING_LABEL_SPACER);
  });

  it("custom field respektuje język", () => {
    const { byName } = renderForm({ customFields }, "en");
    expect(byName("custom_role")).toHaveAttribute("placeholder", "e.g. Director");
  });
});

describe("newsletter: etykieta nadal się unosi", () => {
  it("placeholder przeżywa wpisanie wartości", () => {
    const { byType } = renderForm({ ...EXTRAS, emailPlaceholder_pl: "jan@firma.pl" });
    const email = byType("email");
    expect(email.value).toBe("");
    expect(email.getAttribute("placeholder")).toBe("jan@firma.pl");
  });

  it("wrapper wciąż dokłada klasę `.input`", () => {
    const { byType } = renderForm({ ...EXTRAS, emailPlaceholder_pl: "jan@firma.pl" });
    expect(byType("email").className.split(/\s+/)).toContain("input");
  });
});
