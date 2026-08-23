// HOOK `useNewsletterFieldLabels` - jedyne źródło etykiet pól WSZYSTKICH
// widgetów newslettera (widget "Newsletter", "Dołącz do nas", popup zapisu,
// formularz w stopce).
//
// `newsletterFieldLabels.test.ts` obok dowodzi reguł precedencji na KOPII
// logiki napisanej w teście - to chroni regułę, ale nie chroni hooka:
// pomyłka w samym `useNewsletterFieldLabels` (zła mapa kluczy, zgubiony
// fallback, override liczony odwrotnie) przechodzi tamten test w całości.
// Ten plik wywołuje PRAWDZIWY hook.
//
// Dlaczego to ma znaczenie: etykieta pola jest tym, co odwiedzający czyta nad
// polem formularza rejestracji. Rozjazd między widgetami oznacza, że w jednym
// miejscu prosimy o "Firmę", w drugim o "Organizację", a operator, który
// zmienił brzmienie w panelu (Admin → Popupy), nie widzi zmiany tam, gdzie jej
// oczekuje - i wpisuje ją drugi raz ręcznie w konfiguracji widgetu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Surowa zawartość `newsletter_settings.popup_fields` z panelu. */
  rawFields: null as unknown,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({}) },
}));

// Podmieniamy wyłącznie DROGĘ DO USTAWIEŃ; reguły scalania nadpisań
// z defaultami (`buildRegistrationFieldsApi`) zostają prawdziwe, bo to ich
// wynik ma wygrywać z fabryczną kopią w konfiguracji widgetu.
vi.mock("@/lib/auth/registrationFields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/registrationFields")>();
  return {
    ...actual,
    useRegistrationFields: (lang: "pl" | "en") =>
      actual.buildRegistrationFieldsApi(h.rawFields, lang),
  };
});

import {
  NEWSLETTER_FIELD_FALLBACKS,
  useNewsletterFieldLabels,
} from "@/lib/newsletter/newsletterFieldLabels";

function labels(lang: "pl" | "en" = "pl") {
  return renderHook(() => useNewsletterFieldLabels(lang)).result.current;
}

beforeEach(() => {
  h.rawFields = null;
});

// ---------------------------------------------------------------------------
describe("etykieta pola - skąd bierze się napis nad polem formularza", () => {
  it("zmiana w panelu obowiązuje natychmiast we wszystkich widgetach", () => {
    h.rawFields = [{ key: "email", label_pl: "Adres e-mail", label_en: "E-mail address" }];
    expect(labels("pl").label("email")).toBe("Adres e-mail");
    expect(labels("en").label("email")).toBe("E-mail address");
  });

  it("własne brzmienie wpisane w widgecie wygrywa z konfiguracją globalną", () => {
    h.rawFields = [{ key: "company", label_pl: "Firma / organizacja" }];
    expect(labels("pl").label("company", "  Instytucja  ")).toBe("Instytucja");
    expect(labels("en").label("company", "  Company  ")).toBe("Company");
  });

  it("zapisana KOPIA fabrycznej etykiety ustępuje konfiguracji panelu", () => {
    // Tak powstawały configi widgetów: fabryczna etykieta była w nich zapisana
    // jak override. Gdyby wygrywała, zmiana w panelu nie ruszyłaby widgetu
    // i operator poprawiałby to samo w kilkunastu miejscach.
    h.rawFields = [{ key: "email", label_pl: "Adres e-mail" }];
    expect(labels("pl").label("email", "Twój e-mail")).toBe("Adres e-mail");
    expect(labels("pl").label("email", "Firmowy e-mail")).toBe("Firmowy e-mail");
  });

  it("kopia fabrycznej etykiety z konfiguracji REJESTRACJI też ustępuje panelowi", () => {
    h.rawFields = [{ key: "first_name", label_pl: "Imię (do personalizacji)" }];
    // "Imię" to fabryczna etykieta pola `first_name` w konfiguracji rejestracji.
    expect(labels("pl").label("firstName", "imię")).toBe("Imię (do personalizacji)");
    expect(labels("pl").label("firstName", "Jak się do Ciebie zwracać")).toBe(
      "Jak się do Ciebie zwracać",
    );
  });

  it("pusty albo złożony ze spacji override jest ignorowany, nie zostawia pustej etykiety", () => {
    expect(labels("pl").label("company", "   ")).toBe("Firma / organizacja");
    expect(labels("pl").label("company", null)).toBe("Firma / organizacja");
    expect(labels("pl").label("company")).toBe("Firma / organizacja");
  });
});

// ---------------------------------------------------------------------------
describe("pola spoza konfiguracji rejestracji", () => {
  it("pole bez odpowiednika w panelu ma wbudowaną etykietę w obu językach", () => {
    // `name` i `country` nie mają klucza w konfiguracji rejestracji - gdyby
    // hook szukał ich w panelu, formularz pokazałby pole BEZ etykiety.
    expect(labels("pl").label("name")).toBe(NEWSLETTER_FIELD_FALLBACKS.name.pl);
    expect(labels("en").label("name")).toBe(NEWSLETTER_FIELD_FALLBACKS.name.en);
    expect(labels("pl").label("country")).toBe("Kraj");
    expect(labels("en").label("country")).toBe("Country");
  });

  it("takie pole nadal przyjmuje własne brzmienie z widgetu", () => {
    expect(labels("pl").label("country", "Państwo")).toBe("Państwo");
    expect(labels("en").label("country", "State")).toBe("State");
  });

  it("override będący kopią wbudowanej etykiety nie zmienia nic", () => {
    expect(labels("pl").label("country", "  Kraj  ")).toBe("Kraj");
    expect(labels("pl").label("country", "")).toBe("Kraj");
  });
});

// ---------------------------------------------------------------------------
describe("droplista tematów", () => {
  it("bez nadpisania widget używa wspólnych tekstów - te same we wszystkich widgetach", () => {
    expect(labels("pl").topics("heading")).toBe("Tematy, które Cię interesują (opcjonalnie)");
    expect(labels("en").topics("placeholder")).toBe("Select topics…");
  });

  it("nadpisanie z widgetu wygrywa, puste nadpisanie nie kasuje nagłówka", () => {
    expect(labels("pl").topics("heading", "  Obszary tematyczne  ")).toBe("Obszary tematyczne");
    expect(labels("pl").topics("heading", "   ")).toBe(
      "Tematy, które Cię interesują (opcjonalnie)",
    );
    expect(labels("pl").topics("heading", null)).toBe("Tematy, które Cię interesują (opcjonalnie)");
  });
});
