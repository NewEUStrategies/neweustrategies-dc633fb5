// Ostrzeżenie R1.24 w inspektorze buildera (I9d-Y2b; przegląd R1 - ui-r1-2).
//
// Własny tekst zgody na newsletter w widżetach buildera - treść zgody
// „Dołącz do nas" (`consentText_*`) i etykieta zapisu do newslettera
// w formularzu kontaktu i rejestracji (`newsletterLabel_*`) - który wspomina
// pomiar otwarć i kliknięć, wprowadzałby czytelnika w błąd: zapis przez
// formularz nie daje zgody na pomiar (pomiar ma osobne pole). Panel newslettera
// i zakładka „Pola" popupu ostrzegały już wcześniej; ten plik przybija to samo
// w inspektorze buildera - na PRAWDZIWYCH polach z `WIDGET_SCHEMAS`
// i z prawdziwym słownikiem (zniknięcie klucza oblewa test).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { realT } from "@/test/i18nReal";
import { axeViolations, summarize } from "@/test/axe";
import { WIDGET_SCHEMAS, type SchemaField } from "@/lib/builder/schemas";
import type { WidgetType } from "@/lib/builder/types";
import { newsletterConsentHtml } from "@/lib/newsletter/consentText";
import { SchemaFieldControl } from "../SchemaFieldControl";

const pl = realT("pl");
const WARNING = pl("builder.schemaField.consentMentionsMeasurement");

function fieldOf(type: string, key: string): SchemaField {
  const field = (WIDGET_SCHEMAS[type as WidgetType] ?? []).find((f) => f.key === key);
  if (!field) throw new Error(`brak pola ${type}.${key} w schemacie`);
  return field;
}

function show(field: SchemaField, content: Record<string, unknown>, lang: "pl" | "en" = "pl") {
  return render(
    <SchemaFieldControl field={field} lang={lang} content={content} setContent={() => {}} />,
  );
}

afterEach(() => {
  cleanup();
});

const FIELDS = [
  ["join-us", "consentText"],
  ["contact-form", "newsletterLabel"],
  ["contact", "newsletterLabel"],
  ["register-form", "newsletterLabel"],
] as const;

describe("ostrzeżenie: własny tekst zgody na newsletter wspomina pomiar", () => {
  it("słownik ma napis PL i EN (nie klucz)", () => {
    expect(WARNING).not.toBe("builder.schemaField.consentMentionsMeasurement");
    expect(realT("en")("builder.schemaField.consentMentionsMeasurement")).toMatch(
      /measuring opens and clicks/,
    );
  });

  it.each(FIELDS)("%s.%s: tekst z opisem pomiaru (PL) - notka pod polem", (type, key) => {
    show(fieldOf(type, key), {
      [`${key}_pl`]: "Zapisuję się do newslettera i zgadzam się na pomiar otwarć",
    });
    const note = screen.getByRole("note");
    expect(note.textContent).toBe(WARNING);
    expect(note.getAttribute("data-field-warning")).toBe("newsletterConsentMentionsMeasurement");
    // Notka opisuje pole (czytnik ekranu czyta ją przy kontrolce).
    expect(screen.getByRole("textbox").getAttribute("aria-describedby")).toBe(note.id);
  });

  it.each(FIELDS)(
    "%s.%s: opis pomiaru tylko w EN - notka także przy edycji PL (oba języki)",
    (type, key) => {
      show(fieldOf(type, key), {
        [`${key}_pl`]: "Zapisuję się do newslettera",
        [`${key}_en`]: "I subscribe and agree to measuring opens",
      });
      expect(screen.getByRole("note").textContent).toBe(WARNING);
    },
  );

  it.each(FIELDS)("%s.%s: tekst bez pomiaru, pusty albo domyślny - bez notki", (type, key) => {
    show(fieldOf(type, key), {
      [`${key}_pl`]: "Chcę otrzymywać newsletter",
      [`${key}_en`]: newsletterConsentHtml("en"),
    });
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    show(fieldOf(type, key), {});
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("zgoda RODO formularza kontaktu (nie newsletter) - bez reguły", () => {
    show(fieldOf("contact-form", "consentText"), {
      consentText_pl: "Zgoda na przetwarzanie danych i pomiar",
    });
    expect(screen.queryByRole("note")).toBeNull();
  });

  it.each(["light", "dark"] as const)("pole z notką bez naruszeń axe (motyw %s)", async (theme) => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const { container } = show(fieldOf("join-us", "consentText"), {
      consentText_pl: "Zgoda na newsletter i pomiar kliknięć",
    });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
    document.documentElement.classList.remove("dark");
  });
});
