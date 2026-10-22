// Galeria szablonów ścieżek (S8) - RTL + axe.
//
// CO TEN PLIK DOWODZI.
//   1. Pusta ścieżka + 14 szablonów z katalogu (bez treści maili): nazwa,
//      opis, kategoria, miniatura (dekoracja `aria-hidden`), wyzwalacz, cel,
//      kroki i maile, tematy, wymagania, „czego NIE wysyła”, wskazówka.
//   2. Szablon niedostępny (od I9 żaden w katalogu - dowód na kopii karty
//      oznaczonej jako czekająca) jest wyszarzony, przycisk wyłączony
//      i opisany powodem z nazwą oczekiwanego zdarzenia; B2B (Z-S5-01) jest
//      dostępny i startuje od wiadomości z formularza.
//   3. Wybór (`?template=`) jest zaznaczony `aria-pressed`, „zainstalowany”
//      z listy ścieżek, szablon zastępujący przepis mówi który.
//   4. Stany wczytywania i błędu; axe bez naruszeń.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-start", async () =>
  (await import("@/test/serverFn")).serverFnModuleMock(),
);
vi.mock("@/integrations/supabase/require-staff", () => ({
  requireCrmStaff: { __mw: "requireCrmStaff" },
  requireAdmin: { __mw: "requireAdmin" },
}));

import {
  JourneyTemplateGallery,
  type JourneyTemplateGalleryProps,
} from "../JourneyTemplateGallery";
import { toCatalogEntry } from "@/lib/admin/journeys/journeyEditor.functions";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { JOURNEY_TEMPLATES } from "@/lib/journeys/templates";
import { JOURNEY_TEMPLATE_KEYS } from "@/lib/journeys/templates/types";
import "@/lib/i18n-admin-journeys";
import "@/lib/i18n-admin-journeys-list";

h.fixedT = realT;
const CATALOG = JOURNEY_TEMPLATE_KEYS.map((key) => toCatalogEntry(JOURNEY_TEMPLATES[key]));

function mount(props: Partial<JourneyTemplateGalleryProps> = {}) {
  const handlers = { onSelect: vi.fn(), onBlank: vi.fn(), onClose: vi.fn(), onRetry: vi.fn() };
  const view = render(
    <JourneyTemplateGallery
      catalog={CATALOG}
      isLoading={false}
      isError={false}
      installedKeys={new Set(["trial_ending"])}
      selectedKey={null}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
}

function card(key: string): HTMLElement {
  const element = document.querySelector(`[data-template-key="${key}"]`);
  if (!element) throw new Error(`brak karty ${key}`);
  return element as HTMLElement;
}

afterEach(() => {
  cleanup();
  h.lang = "pl";
});

describe("JourneyTemplateGallery", () => {
  it("pusta ścieżka i 14 szablonów z faktami; axe bez naruszeń", async () => {
    const t = realT("pl");
    const { container } = mount();
    const region = screen.getByRole("region", { name: t("adminJourneys.gallery.title") });
    const list = within(region).getByRole("list", { name: t("adminJourneys.gallery.list") });
    const items = within(list)
      .getAllByRole("listitem")
      .filter((li) => li.parentElement === list);
    expect(items).toHaveLength(15);
    expect(within(region).getAllByRole("heading", { level: 3 })).toHaveLength(15);
    const welcome = card("welcome_onboarding");
    expect(welcome).toHaveAccessibleName(t("adminJourneys.templates.welcome_onboarding.name"));
    expect(welcome).toHaveTextContent(t("adminJourneys.templates.welcome_onboarding.description"));
    expect(welcome).toHaveTextContent(t("adminJourneys.common.category.marketing"));
    expect(welcome).toHaveTextContent(t("adminJourneys.trigger.account_registered"));
    expect(welcome).toHaveTextContent(t("adminJourneys.trigger.checkout_completed"));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.stepCount", { count: 9 }));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.emailCount", { count: 3 }));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.requirement.marketingConsent"));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.requirement.senderName"));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.doesNotSend.withoutConsent"));
    expect(welcome).toHaveTextContent(t("adminJourneys.gallery.tip.welcome_onboarding"));
    expect(welcome).toHaveTextContent(JOURNEY_TEMPLATES.welcome_onboarding.emails[0].subject.pl);
    const thumbnail = within(welcome).getByTestId("journey-template-thumbnail");
    expect(thumbnail).toHaveAttribute("aria-hidden", "true");
    expect(thumbnail.querySelectorAll("rect")).toHaveLength(9);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("szablon niedostępny: wyszarzony, przycisk wyłączony i opisany powodem", () => {
    const t = realT("pl");
    mount({
      catalog: CATALOG.map((entry) =>
        entry.key === "pricing_enquiry_b2b"
          ? {
              ...entry,
              availability: {
                status: "unavailable" as const,
                awaitedEvent: "contact_message.submitted.v1",
              },
            }
          : entry,
      ),
    });
    const pricing = card("pricing_enquiry_b2b");
    expect(pricing).toHaveAttribute("data-available", "false");
    expect(pricing).toHaveClass("opacity-60");
    expect(pricing).toHaveTextContent(t("adminJourneys.gallery.unavailable"));
    const button = within(pricing).getByRole("button", {
      name: t("adminJourneys.gallery.useFor", {
        name: t("adminJourneys.templates.pricing_enquiry_b2b.name"),
      }),
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      t("adminJourneys.gallery.unavailableReason", { event: "contact_message.submitted.v1" }),
    );
    expect(pricing).toHaveTextContent(t("adminJourneys.gallery.doesNotSend.noEmails"));
    expect(card("welcome_onboarding")).toHaveAttribute("data-available", "true");
  });

  it("B2B dostępny (I9, Z-S5-01): przycisk aktywny, wyzwalacz - wiadomość z formularza", () => {
    const t = realT("pl");
    mount();
    const pricing = card("pricing_enquiry_b2b");
    expect(pricing).toHaveAttribute("data-available", "true");
    expect(pricing).not.toHaveTextContent(t("adminJourneys.gallery.unavailable"));
    expect(pricing).toHaveTextContent(t("adminJourneys.trigger.contact_message_submitted"));
    expect(
      within(pricing).getByRole("button", {
        name: t("adminJourneys.gallery.useFor", {
          name: t("adminJourneys.templates.pricing_enquiry_b2b.name"),
        }),
      }),
    ).toBeEnabled();
  });

  it("wybór z adresu zaznaczony aria-pressed; klik wybiera szablon", () => {
    const t = realT("pl");
    const { onSelect } = mount({ selectedKey: "abandoned_checkout" });
    const name = (key: string) =>
      t("adminJourneys.gallery.useFor", { name: t(`adminJourneys.templates.${key}.name`) });
    expect(screen.getByRole("button", { name: name("abandoned_checkout") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(card("abandoned_checkout")).toHaveAttribute("data-selected", "true");
    expect(screen.getByRole("button", { name: name("winback_30d") })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: name("winback_30d") }));
    expect(onSelect).toHaveBeenCalledWith("winback_30d");
  });

  it("zainstalowany, usługa, zastępowany przepis", () => {
    const t = realT("pl");
    mount();
    expect(card("trial_ending")).toHaveTextContent(t("adminJourneys.gallery.installed"));
    expect(card("trial_ending")).toHaveTextContent(
      t("adminJourneys.gallery.requirement.legalBasis"),
    );
    expect(card("trial_ending")).toHaveTextContent(
      t("adminJourneys.gallery.doesNotSend.promotions"),
    );
    expect(card("welcome_onboarding")).not.toHaveTextContent(t("adminJourneys.gallery.installed"));
    expect(card("cancel_scheduled_save")).toHaveTextContent(
      "subscription-cancel-scheduled-crm-task",
    );
    expect(card("abandoned_checkout")).toHaveTextContent(
      t("adminJourneys.gallery.cooldown", { count: 14 }),
    );
  });

  it("pusta ścieżka i zamknięcie galerii", () => {
    const t = realT("pl");
    const { onBlank, onClose } = mount();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.gallery.blankAction") }));
    expect(onBlank).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.gallery.close") }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ onClose: undefined });
    expect(screen.queryByRole("button", { name: t("adminJourneys.gallery.close") })).toBeNull();
  });

  it("wczytywanie i błąd z ponowieniem", () => {
    const t = realT("pl");
    mount({ catalog: null, isLoading: true });
    expect(screen.getByRole("status")).toHaveTextContent(t("adminJourneys.gallery.loading"));
    cleanup();
    const { onRetry } = mount({ catalog: null, isError: true });
    expect(screen.getByText(t("adminJourneys.gallery.loadError"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("adminJourneys.common.retry") }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("panel angielski: tematy maili po angielsku", () => {
    h.lang = "en";
    mount();
    expect(card("welcome_onboarding")).toHaveTextContent(
      JOURNEY_TEMPLATES.welcome_onboarding.emails[0].subject.en,
    );
    expect(card("welcome_onboarding")).toHaveTextContent("Insider tip");
  });
});
