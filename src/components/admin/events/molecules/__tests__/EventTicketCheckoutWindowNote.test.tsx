// Karta biletów: linia o oknie porzucenia kasy (I9b, Z-S3-07).
//
// CO TEN PLIK DOWODZI.
//   1. Linia pokazuje BIEŻĄCE okno z `checkout_settings` (90 min), a wiersz
//      bez kolumny - domyślne 1440, tak jak karta kasy (wspólny helper).
//   2. Odnośnik prowadzi do karty kasy paywalla (`/admin/paywall?tab=checkout`).
//   3. Odczyt idzie wspólnym wpisem cache karty kasy (`checkoutKeys.settings()`):
//      jedno zapytanie o `checkout_settings`, także gdy karta kasy wczytała je
//      wcześniej - zero nowego zapytania o tę samą kolumnę.
//   4. Angielski panel mówi po angielsku; błąd odczytu chowa linię.
//   5. Brak naruszeń axe.
//
// Tłumacz PRAWDZIWY, wstrzykiwany do atrapy po imporcie - fabryka `vi.mock`
// importująca `@/test/i18nReal` zakleszcza plik (`ReputationLevelChip.test`).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fail, ok, type SupabaseFromStub } from "@/test/supabase";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  fixedT: null as null | ((lang: "pl" | "en") => unknown),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
// Odnośnik z parametrami adresu w `href` - asercja czyta prawdziwy cel.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    to,
    search,
    children,
    className,
  }: {
    to: string;
    search?: Record<string, string>;
    children: ReactNode;
    className?: string;
  }) => (
    <a href={`${to}?${new URLSearchParams(search).toString()}`} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabase");
  const db = supabaseFromStub();
  return { supabase: { from: db.from }, db };
});

import * as client from "@/integrations/supabase/client";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { EventTicketCheckoutWindowNote } from "@/components/admin/events/molecules/EventTicketCheckoutWindowNote";
import { checkoutSettingsQueryOptions } from "@/hooks/useCheckoutSettings";
import { DEFAULT_CHECKOUT_SETTINGS } from "@/lib/billing/checkoutSettings";
import "@/lib/i18n-admin-event-registration";

h.fixedT = realT;

const db: SupabaseFromStub = Reflect.get(client, "db");
const ROW = { ...DEFAULT_CHECKOUT_SETTINGS, abandon_after_minutes: 90, updated_at: "t1" };

let qc: QueryClient;
beforeEach(() => {
  db.reset();
  db.setResponse("checkout_settings", () => ok(ROW));
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  qc.clear();
  h.lang = "pl";
});

function mount() {
  return render(
    <QueryClientProvider client={qc}>
      <EventTicketCheckoutWindowNote />
    </QueryClientProvider>,
  );
}

describe("EventTicketCheckoutWindowNote", () => {
  it("bieżące okno z ustawień kasy i odnośnik do karty kasy (PL)", async () => {
    const t = realT("pl");
    mount();
    const link = await screen.findByRole("link", {
      name: t("adminEventRegistration.tickets.checkoutWindow.link"),
    });
    expect(link).toHaveAttribute("href", "/admin/paywall?tab=checkout");
    const line = link.closest("p");
    expect(line).toHaveTextContent(
      t("adminEventRegistration.tickets.checkoutWindow.note", { minutes: 90 }),
    );
    expect(line).toHaveTextContent("90 min");
  });

  it("najemca bez wiersza - domyślne 1440 min (to samo, co karta kasy)", async () => {
    db.setResponse("checkout_settings", () => ok(null));
    mount();
    expect(await screen.findByText(/1440 min/)).toBeInTheDocument();
  });

  it("wspólny wpis cache z kartą kasy: jedno zapytanie o checkout_settings", async () => {
    await qc.fetchQuery(checkoutSettingsQueryOptions());
    expect(db.chainsFor("checkout_settings")).toHaveLength(1);
    mount();
    expect(await screen.findByText(/90 min/)).toBeInTheDocument();
    expect(db.chainsFor("checkout_settings")).toHaveLength(1);
  });

  it("panel EN mówi po angielsku", async () => {
    h.lang = "en";
    const t = realT("en");
    mount();
    const link = await screen.findByRole("link", { name: "Change it in checkout settings" });
    expect(link.closest("p")).toHaveTextContent(
      t("adminEventRegistration.tickets.checkoutWindow.note", { minutes: 90 }),
    );
    expect(link.closest("p")).toHaveTextContent("unpaid ticket reservation expires after 90 min");
  });

  it("błąd odczytu ustawień - linia schowana (karta biletów działa bez niej)", async () => {
    db.setResponse("checkout_settings", () => fail("boom"));
    const { container } = mount();
    const { queryKey } = checkoutSettingsQueryOptions();
    await waitFor(() => expect(qc.getQueryState(queryKey)?.status).toBe("error"));
    expect(container).toBeEmptyDOMElement();
  });

  it("brak naruszeń axe", async () => {
    const { container } = mount();
    await screen.findByRole("link");
    expect(summarize(await axeViolations(container))).toBe("");
  });
});
