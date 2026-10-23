// Widżet „Formularz kontaktowy" - pole zapisu na newsletter (I9d-Y2,
// I9d-Y2b).
//
// Pole wyboru pokazywało krótką etykietę „Zapisz mnie do newslettera"
// (domyślna z rejestru buildera kopiowana do strony), a do rejestru zgód
// trafiała ta sama etykieta. Teraz etykieta pusta albo domyślna = pełna
// treść zgody z jednego źródła (b, bez pomiaru, z wersją), a etykieta własna
// redakcji zostaje bez zmian i bez wersji.
//
// I9d-Y2b (wariant (b)): pod polem newslettera stoi OSOBNE pole zgody na
// pomiar otwarć i kliknięć - domyślnie niezaznaczone, wyłączone bez
// newslettera i czyszczone przy jego odznaczeniu; deklaracja jedzie
// w `consents` wyłącznie po zaznaczeniu.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor, screen } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import {
  NEWSLETTER_CONSENT_VERSION,
  newsletterConsentHtml,
  newsletterConsentPlain,
} from "@/lib/newsletter/consentText";
import {
  EMAIL_MEASUREMENT_CONSENT_VERSION,
  measurementConsentHtml,
  measurementConsentPlain,
} from "@/lib/newsletter/measurementConsentText";

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

/** Pole „newsletter" (osobne pole pomiaru ma własny pomocnik). */
const newsletterBox = () => {
  const boxes = screen
    .getAllByRole("checkbox")
    .filter((el) => !el.closest('[data-consent="email_measurement"]'));
  expect(boxes).toHaveLength(1);
  return boxes[0];
};
/** Osobne pole zgody na pomiar (I9d-Y2b). */
const measurementBox = () =>
  document.querySelector<HTMLElement>('[data-consent="email_measurement"] [role="checkbox"]');

function fillAndSend(
  field: (name: string) => HTMLInputElement | HTMLTextAreaElement,
  { measurement = false } = {},
) {
  fireEvent.change(field("firstName"), { target: { value: "Jan" } });
  fireEvent.change(field("lastName"), { target: { value: "Kowalski" } });
  fireEvent.change(field("email"), { target: { value: "jan@firma.pl" } });
  fireEvent.change(field("message"), { target: { value: "Pytanie o raport" } });
  fireEvent.click(newsletterBox());
  if (measurement) fireEvent.click(measurementBox() as HTMLElement);
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

  it("etykieta domyślna pokazuje i zapisuje pełną treść zgody (b) z wersją", async () => {
    const { field } = renderForm({});
    expect(newsletterBox().closest("label")?.textContent).toBe(newsletterConsentPlain("pl"));
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

  it("etykieta własna redakcji zostaje i nie dostaje wersji", async () => {
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
    expect(screen.getByRole("link", { name: "Polityka prywatności" })).toHaveAttribute(
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

describe("contact-form: osobne pole zgody na pomiar (I9d-Y2b)", () => {
  it("pole stoi pod newsletterem w tej samej geometrii, niezaznaczone i wyłączone bez newslettera", () => {
    renderForm({});
    const box = measurementBox();
    expect(box).not.toBeNull();
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toBeDisabled();
    const row = box?.closest("label");
    expect(row?.textContent).toBe(measurementConsentPlain("pl"));
    // Ta sama klasa wiersza co pole newslettera (rozmiar `consentSize`
    // i znacznik edycji z `.cf-consent`).
    expect(row?.classList.contains("cf-consent")).toBe(true);
    expect(
      newsletterBox().compareDocumentPosition(box as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("odznaczenie newslettera czyści i wyłącza pole pomiaru", () => {
    renderForm({});
    fireEvent.click(newsletterBox());
    expect(measurementBox()).not.toBeDisabled();
    fireEvent.click(measurementBox() as HTMLElement);
    expect(measurementBox()).toHaveAttribute("aria-checked", "true");
    fireEvent.click(newsletterBox());
    expect(measurementBox()).toHaveAttribute("aria-checked", "false");
    expect(measurementBox()).toBeDisabled();
  });

  it("zaznaczone pole dokłada deklarację z wersją z rejestru", async () => {
    const { field } = renderForm({});
    fillAndSend(field, { measurement: true });
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    expect(sentConsents()).toEqual([
      {
        key: "newsletter",
        text: newsletterConsentHtml("pl"),
        given: true,
        lang: "pl",
        version: NEWSLETTER_CONSENT_VERSION,
      },
      {
        key: "email_measurement_declared",
        text: measurementConsentHtml("pl"),
        version: EMAIL_MEASUREMENT_CONSENT_VERSION,
        given: true,
        lang: "pl",
      },
    ]);
    expect(
      (h.submit.mock.calls[0][0] as { data: { newsletterOptIn: boolean } }).data.newsletterOptIn,
    ).toBe(true);
  });

  it("bez newslettera nie ma ani zgody, ani deklaracji pomiaru", async () => {
    const { field } = renderForm({});
    fireEvent.change(field("firstName"), { target: { value: "Jan" } });
    fireEvent.change(field("lastName"), { target: { value: "Kowalski" } });
    fireEvent.change(field("email"), { target: { value: "jan@firma.pl" } });
    fireEvent.change(field("message"), { target: { value: "Pytanie o raport" } });
    fireEvent.submit(field("email").closest("form")!);
    await waitFor(() => expect(h.submit).toHaveBeenCalledTimes(1));
    const data = (
      h.submit.mock.calls[0][0] as { data: { consents: unknown[]; newsletterOptIn: boolean } }
    ).data;
    expect(data.consents).toEqual([]);
    expect(data.newsletterOptIn).toBe(false);
  });

  it("formularz bez pola newslettera nie ma też pola pomiaru", () => {
    renderForm({ showNewsletterOptIn: false });
    expect(measurementBox()).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "wiersz pomiaru bez naruszeń axe (motyw %s)",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      try {
        renderForm({});
        fireEvent.click(newsletterBox());
        const row = measurementBox()?.closest("label") as HTMLElement;
        const violations = await axeViolations(row);
        expect(violations, summarize(violations)).toEqual([]);
      } finally {
        document.documentElement.classList.remove("dark");
      }
    },
  );
});
