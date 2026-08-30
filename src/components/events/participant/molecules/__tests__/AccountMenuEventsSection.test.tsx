// SKRÓT „MOJE WYDARZENIA” W MENU KONTA - dwa kliknięcia mniej w dniu wydarzenia.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. PUSTA SEKCJA TO BRAK SEKCJI. Uczestnik bez nadchodzących wydarzeń ma
//     dostać menu bez separatora, bez nagłówka i bez pustego miejsca - inaczej
//     każdy użytkownik serwisu ogląda w menu dziurę po funkcji, która go nie
//     dotyczy.
//
//  2. JEDNO WYDARZENIE = JEDEN WIERSZ. Bilet i warsztat na tym samym kongresie
//     to DWA zgłoszenia; skrót prowadzi do panelu WYDARZENIA, więc podwojony
//     wiersz nie niesie żadnej nowej informacji, a zjada całą sekcję.
//
//  3. SEKCJA JEST SKRÓTEM, NIE LISTĄ. Najwyżej trzy pozycje; po resztę prowadzi
//     odnośnik do historii wydarzeń w profilu.
//
//  4. MINIONE WYDARZENIA TU NIE WCHODZĄ. Menu odpowiada na pytanie „gdzie mam
//     być”, a nie „gdzie byłem”.
//
//  5. KLIKNIĘCIE ZAMYKA PANEL. Bez wywołania `onNavigate` popover menu konta
//     zostaje otwarty nad nową stroną.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Reguły podziału na koszyki (`groupMyEvents`)
// i warstwy odczytu (`fetchMyRegistrations`) - mają własne pliki testowe.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";

import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  jezyk: { current: "pl" },
  pobierz: vi.fn<() => Promise<ParticipantRegistration[]>>(),
  zamknij: vi.fn(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

vi.mock("@/lib/events/participantTicketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/participantTicketsApi")>()),
  fetchMyRegistrations: () => h.pobierz(),
}));

const { AccountMenuEventsSection } =
  await import("@/components/events/participant/molecules/AccountMenuEventsSection");

const DOBA = 24 * 60 * 60 * 1000;

/** Czas liczymy WZGLĘDEM TERAZ - sekcja woła `new Date()` sama. */
function zaIle(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function zapis(over: Partial<ParticipantRegistration> = {}): ParticipantRegistration {
  return {
    registrationId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    ticketTypeId: null,
    status: "confirmed",
    paymentStatus: "paid",
    createdAt: zaIle(-10 * DOBA),
    cancelledAt: null,
    paidAt: zaIle(-10 * DOBA),
    waitlistPosition: null,
    promotedAt: null,
    notifyEmail: true,
    notifySms: false,
    cancelReason: null,
    decisionSource: null,
    eventSlug: "kongres-cee",
    eventTitlePl: "Kongres CEE 2026",
    eventTitleEn: "CEE Congress 2026",
    eventStartsAt: zaIle(7 * DOBA),
    eventEndsAt: zaIle(8 * DOBA),
    eventTimezone: "Europe/Warsaw",
    orderStatus: "paid",
    amountCents: 0,
    refundedCents: 0,
    currency: "PLN",
    webhooks: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.jezyk.current = "pl";
  h.pobierz.mockResolvedValue([zapis()]);
});

describe("AccountMenuEventsSection", () => {
  it("bez nadchodzących wydarzeń NIE rysuje niczego - także separatora", async () => {
    h.pobierz.mockResolvedValue([]);
    const { container } = renderWithQueryClient(
      <AccountMenuEventsSection onNavigate={h.zamknij} />,
    );

    // Pusta od pierwszej klatki i taka ZOSTAJE po odpowiedzi bazy.
    expect(container.textContent).toBe("");
    await vi.waitFor(() => expect(h.pobierz).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("wydarzenie, które już się odbyło, nie wchodzi do skrótu", async () => {
    h.pobierz.mockResolvedValue([
      zapis({ eventStartsAt: zaIle(-30 * DOBA), eventEndsAt: zaIle(-29 * DOBA) }),
    ]);
    const { container } = renderWithQueryClient(
      <AccountMenuEventsSection onNavigate={h.zamknij} />,
    );

    await vi.waitFor(() => expect(h.pobierz).toHaveBeenCalled());
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("nadchodzące wydarzenie prowadzi WPROST do panelu uczestnika", async () => {
    renderWithQueryClient(<AccountMenuEventsSection onNavigate={h.zamknij} />);

    const link = await screen.findByRole("link", { name: /Kongres CEE 2026/ });
    expect(link.getAttribute("href")).toBe("/events/kongres-cee/me");
    expect(screen.getByText("myEvents.title")).toBeTruthy();
  });

  it("dwa zgłoszenia na TO SAMO wydarzenie dają JEDEN wiersz", async () => {
    h.pobierz.mockResolvedValue([
      zapis(),
      zapis({ registrationId: "99999999-9999-4999-8999-999999999999" }),
    ]);
    renderWithQueryClient(<AccountMenuEventsSection onNavigate={h.zamknij} />);

    await screen.findByRole("link", { name: /Kongres CEE 2026/ });
    expect(screen.getAllByRole("link", { name: /Kongres CEE 2026/ })).toHaveLength(1);
  });

  it("skrót ma najwyżej TRZY pozycje - reszta idzie przez odnośnik do profilu", async () => {
    h.pobierz.mockResolvedValue(
      ["a", "b", "c", "d", "e"].map((slug, index) =>
        zapis({
          registrationId: `1111111${index}-1111-4111-8111-111111111111`,
          eventSlug: `wydarzenie-${slug}`,
          eventTitlePl: `Wydarzenie ${slug.toUpperCase()}`,
          eventStartsAt: zaIle((index + 1) * DOBA),
          eventEndsAt: zaIle((index + 1) * DOBA + 3600_000),
        }),
      ),
    );
    renderWithQueryClient(<AccountMenuEventsSection onNavigate={h.zamknij} />);

    await screen.findByRole("link", { name: /Wydarzenie A/ });
    // Trzy najbliższe wydarzenia + odnośnik „zarządzaj biletami”.
    expect(screen.getAllByRole("link")).toHaveLength(4);
    expect(screen.queryByRole("link", { name: /Wydarzenie D/ })).toBeNull();
    expect(screen.getByRole("link", { name: "myEvents.manageTickets" }).getAttribute("href")).toBe(
      "/profile/events",
    );
  });

  it("kliknięcie w skrót ZAMYKA panel menu", async () => {
    renderWithQueryClient(<AccountMenuEventsSection onNavigate={h.zamknij} />);

    fireEvent.click(await screen.findByRole("link", { name: /Kongres CEE 2026/ }));
    expect(h.zamknij).toHaveBeenCalledTimes(1);
  });

  it("angielski interfejs bierze angielski tytuł, a brak obu tytułów cofa się do slugu", async () => {
    h.jezyk.current = "en";
    h.pobierz.mockResolvedValue([
      zapis(),
      zapis({
        registrationId: "88888888-8888-4888-8888-888888888888",
        eventSlug: "forum-baltyckie",
        eventTitlePl: null,
        eventTitleEn: null,
        eventStartsAt: zaIle(9 * DOBA),
        eventEndsAt: zaIle(10 * DOBA),
      }),
    ]);
    renderWithQueryClient(<AccountMenuEventsSection onNavigate={h.zamknij} />);

    expect(await screen.findByText("CEE Congress 2026")).toBeTruthy();
    expect(screen.getByText("forum-baltyckie")).toBeTruthy();
  });

  it("sekcja skrótu nie ma naruszeń axe", async () => {
    const { container } = renderWithQueryClient(
      <AccountMenuEventsSection onNavigate={h.zamknij} />,
    );

    await screen.findByRole("link", { name: /Kongres CEE 2026/ });
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
