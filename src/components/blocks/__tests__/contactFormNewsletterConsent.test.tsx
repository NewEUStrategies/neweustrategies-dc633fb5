// Widżet „Formularz kontaktowy" - pole zapisu na newsletter (I9d-Y2).
//
// Pole wyboru pokazywało krótką etykietę „Zapisz mnie do newslettera"
// (domyślna z rejestru buildera kopiowana do strony), a do rejestru zgód
// trafiała ta sama etykieta - bez słowa o pomiarze otwarć i kliknięć.
// Teraz etykieta pusta albo domyślna = pełna treść zgody z jednego źródła
// (z wersją z pomiarem), a etykieta własna redakcji zostaje bez zmian i bez
// wersji (pomiar jej nie obejmuje).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import {
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  newsletterConsentPlain,
} from "@/lib/newsletter/consentText";

const h = vi.hoisted(() => ({ submit: vi.fn() }));

vi.mock("@tanstack/react-start", () => ({ useServerFn: () => h.submit }));
vi.mock("@/lib/contact.functions", () => ({ submitContactMessage: {} }));

import { ContactFormView } from "../ContactFormView";
import { WIDGETS } from "@/lib/builder/registry";

beforeEach(() => {
  h.submit.mockReset().mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

type Cfg = Record<string, unknown>;

function renderForm(data: Cfg, lang: "pl" | "en" = "pl") {
  const view = render(
    <ContactFormView
      data={{ requireConsent: false, showNewsletterOptIn: true, ...data }}
      lang={lang}
    />,
  );
  const field = (name: string) =>
    view.container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)!;
  return { ...view, field };
}

function fillAndSend(field: (name: string) => HTMLInputElement | HTMLTextAreaElement) {
  fireEvent.change(field("firstName"), { target: { value: "Jan" } });
  fireEvent.change(field("lastName"), { target: { value: "Kowalski" } });
  fireEvent.change(field("email"), { target: { value: "jan@firma.pl" } });
  fireEvent.change(field("message"), { target: { value: "Pytanie o raport" } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(field("email").closest("form")!);
}

const sentConsents = () =>
  (h.submit.mock.calls[0][0] as { data: { consents?: unknown[] } }).data.consents;

describe("contact-form: zgoda na newsletter z jednego źródła", () => {
  it("rejestr buildera nie kopiuje treści etykiety do strony", () => {
    const widget = WIDGETS.find((entry) => entry.type === "contact-form");
    const defaults = widget?.defaults() as Cfg | undefined;
    expect(defaults?.newsletterLabel_pl).toBe("");
    expect(defaults?.newsletterLabel_en).toBe("");
  });

  it("etykieta domyślna pokazuje i zapisuje pełną treść zgody z wersją pomiaru", async () => {
    const { field } = renderForm({});
    expect(screen.getByRole("checkbox").closest("label")?.textContent).toBe(
      newsletterConsentPlain("pl"),
    );
    fillAndSend(field);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(sentConsents()).toEqual([
      {
        key: "newsletter",
        text: newsletterConsentHtml("pl"),
        given: true,
        lang: "pl",
        version: NEWSLETTER_CONSENT_VERSION,
      },
    ]);
  });

  it("dawna kopia etykiety w treści strony = bieżąca treść zgody (EN)", async () => {
    const { field } = renderForm({ newsletterLabel_en: "Subscribe me to the newsletter" }, "en");
    expect(screen.queryByText("Subscribe me to the newsletter")).toBeNull();
    fillAndSend(field);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(sentConsents()).toEqual([
      expect.objectContaining({
        text: newsletterConsentHtml("en"),
        lang: "en",
        version: NEWSLETTER_CONSENT_VERSION,
      }),
    ]);
  });

  it("etykieta własna redakcji zostaje i nie dostaje wersji pomiaru", async () => {
    const { field } = renderForm({ newsletterLabel_pl: "Chcę biuletyn o Unii Europejskiej" });
    expect(screen.getByText("Chcę biuletyn o Unii Europejskiej")).toBeTruthy();
    fillAndSend(field);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(sentConsents()).toEqual([
      { key: "newsletter", text: "Chcę biuletyn o Unii Europejskiej", given: true, lang: "pl" },
    ]);
  });

  it("linki treści zgody są dostępne (axe)", async () => {
    const { container } = renderForm({});
    expect(screen.getByRole("link", { name: "Politykę prywatności" })).toHaveAttribute(
      "href",
      "/polityka-prywatnosci",
    );
    expect(screen.getByRole("link", { name: "jak to zrobić" })).toHaveAttribute(
      "href",
      "/komunikacja-i-marketing#rezygnacja",
    );
    // Zakres: wiersz zgody na newsletter (pola tekstowe formularza mają
    // własne testy etykiet).
    const row = container.querySelector("label.cf-consent")!;
    const violations = await axeViolations(row);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
