// MOJE WYDARZENIA w globalnym profilu - „gdzie ja właściwie byłem i gdzie będę”.
//
// CO TEN PLIK DOWODZI I DLACZEGO TO WAŻNE:
//
//  1. TRZY ODPOWIEDZI, NIE JEDNA. „Jeszcze nie wiem” (wczytywanie), „nie udało
//     się” (odmowa/awaria RPC) i „nie masz nic” (pusta lista) to trzy różne
//     zdania. Zlanie ich w jedno pokazuje uczestnikowi „nie masz żadnych
//     zapisów” w chwili, w której baza właśnie odmówiła odpowiedzi - i człowiek
//     zapisuje się DRUGI RAZ na wydarzenie, na którym już jest.
//
//  2. DOMYŚLNA ZAKŁADKA TO DECYZJA, NIE KOSMETYKA. Gdy coś TRWA, ekran otwiera
//     się na „bieżących”, bo to jedyny moment z pilną sprawą (wejście, agenda,
//     kod QR). Gdy nic nie trwa - na „nadchodzących”.
//
//  3. NIEOPŁACONE ZGŁOSZENIE MA DROGĘ DO KASY. Plakietka „nieopłacone” bez
//     przycisku to ślepy zaułek; odnośnik prowadzi na stronę wydarzenia
//     z kotwicą `#tickets`, czyli tam, gdzie da się zapłacić.
//
//  4. BEZPŁATNE NIE JEST NIEOPŁACONE. Zapis bez kwoty ma własną plakietkę -
//     inaczej każdy darmowy udział straszy uczestnika długiem, którego nie ma.
//
//  5. KAŻDY WIERSZ PROWADZI DO SWOJEGO WYDARZENIA. Odnośniki mają podstawiony
//     slug TEGO wiersza; wspólny adres wysyłałby uczestnika na cudzy panel.
//
//  6. PUSTY KOSZYK KALENDARZA MA SWOJE ZDANIE. „Brak nadchodzących” i „brak
//     minionych” to dwa różne komunikaty, bo znaczą co innego.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. (1) Reguły podziału na koszyki (`groupMyEvents`,
// `awaitsPayment`) - mają własny plik testowy w `src/lib/events/__tests__/`.
// (2) Osi płatności i kanałów powiadomień - to „Moje zgłoszenia”
// (`ParticipantTicketsPanel`) i jego własny plik.
//
// Asercje idą po KLUCZACH i18n oraz po `href` odnośników.
import { createContext, useContext, useState, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";

import type { ParticipantRegistration } from "@/lib/events/participantTicketsApi";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";
import { axeViolations, summarize } from "@/test/axe";

const h = vi.hoisted(() => ({
  jezyk: { current: "pl" },
  pobierz: vi.fn<() => Promise<ParticipantRegistration[]>>(),
}));

vi.mock("react-i18next", async () =>
  (await import("@/test/i18nStub")).reactI18nextStub(() => h.jezyk.current),
);

vi.mock("@/lib/i18n-cart", () => ({ ensureI18n: () => {} }));

// `Link` bez pełnego drzewa tras - wspólna atrapa repo podstawia parametry,
// więc asercja czyta PRAWDZIWY cel odnośnika, a nie szablon `/events/$slug`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

// ZAKŁADKI JAKO ATRAPA, BO DOWODEM JEST `defaultValue`. Radix montuje wyłącznie
// aktywną zawartość i nie wystawia „która zakładka jest domyślna” inaczej niż
// przez to, co narysował. Atrapa zachowuje TĘ SAMĄ semantykę (jedna widoczna
// zawartość, przełączanie klikiem), a dodatkowo odsłania wybraną wartość - to
// pozwala odróżnić „ekran otworzył się na bieżących” od „ekran otworzył się na
// nadchodzących, a bieżące akurat są puste”.
const Ctx = createContext<{ value: string; set: (next: string) => void }>({
  value: "",
  set: () => {},
});

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ defaultValue, children }: { defaultValue: string; children?: ReactNode }) => {
    const [value, setValue] = useState(defaultValue);
    return (
      <Ctx.Provider value={{ value, set: setValue }}>
        <div data-testid="zakladki" data-domyslna={defaultValue} data-wybrana={value}>
          {children}
        </div>
      </Ctx.Provider>
    );
  },
  TabsList: ({ children }: { children?: ReactNode }) => <div role="tablist">{children}</div>,
  TabsTrigger: ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = useContext(Ctx);
    return (
      <button
        type="button"
        role="tab"
        aria-selected={ctx.value === value}
        onClick={() => ctx.set(value)}
      >
        {children}
      </button>
    );
  },
  TabsContent: ({ value, children }: { value: string; children?: ReactNode }) => {
    const ctx = useContext(Ctx);
    return ctx.value === value ? <div data-zakladka={value}>{children}</div> : null;
  },
}));

vi.mock("@/lib/events/participantTicketsApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/events/participantTicketsApi")>()),
  fetchMyRegistrations: () => h.pobierz(),
}));

const { MyEventsPanel } = await import("@/components/profile/events/MyEventsPanel");

const GODZINA = 60 * 60 * 1000;
const DOBA = 24 * GODZINA;

/**
 * Czas liczymy WZGLĘDEM TERAZ, bo panel woła `new Date()` sam. Sztywna data
 * w atrapie zestarzałaby się i test zaczynałby padać w przyszłości - a to
 * dokładnie ten rodzaj czerwieni, który uczy ignorować czerwień.
 */
function zaIle(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function zapis(over: Partial<ParticipantRegistration> = {}): ParticipantRegistration {
  return {
    registrationId: "11111111-1111-4111-8111-111111111111",
    eventId: "22222222-2222-4222-8222-222222222222",
    ticketTypeId: "33333333-3333-4333-8333-333333333333",
    status: "confirmed",
    paymentStatus: "paid",
    createdAt: zaIle(-30 * DOBA),
    cancelledAt: null,
    paidAt: zaIle(-30 * DOBA),
    waitlistPosition: null,
    promotedAt: null,
    notifyEmail: true,
    notifySms: false,
    cancelReason: null,
    decisionSource: null,
    eventSlug: "kongres-cee",
    eventTitlePl: "Kongres CEE 2026",
    eventTitleEn: "CEE Congress 2026",
    eventStartsAt: zaIle(14 * DOBA),
    eventEndsAt: zaIle(15 * DOBA),
    eventTimezone: "Europe/Warsaw",
    orderStatus: "paid",
    amountCents: 15000,
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

describe("MyEventsPanel - „nie wiem” kontra „nie udało się” kontra „pusto”", () => {
  it("dopóki RPC nie odpowie, stoją szkielety - ANI zdania o pustce, ANI o błędzie", () => {
    // Obietnica, która nigdy się nie rozstrzyga: zapytanie zostaje w `isPending`.
    h.pobierz.mockReturnValue(new Promise<ParticipantRegistration[]>(() => {}));
    const { container } = renderWithQueryClient(<MyEventsPanel />);

    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(screen.queryByText("myEvents.loadError")).toBeNull();
    expect(screen.queryByText("myEvents.emptyUpcoming")).toBeNull();
    expect(screen.queryByTestId("zakladki")).toBeNull();
  });

  it("odmowa bazy ma WŁASNE zdanie i NIE udaje pustego kalendarza", async () => {
    h.pobierz.mockRejectedValue(new Error("auth_required: sign in"));
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.loadError")).toBeTruthy();
    // To jest cała stawka tego testu: awaria nie może mówić „nie masz nic”.
    expect(screen.queryByText("myEvents.emptyUpcoming")).toBeNull();
    expect(screen.queryByText("myEvents.emptyPast")).toBeNull();
    expect(screen.queryByTestId("zakladki")).toBeNull();
  });

  it("pusta lista to zdanie o braku zapisów, a nie błąd", async () => {
    h.pobierz.mockResolvedValue([]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.emptyUpcoming")).toBeTruthy();
    expect(screen.queryByText("myEvents.loadError")).toBeNull();
  });

  it("odnośnik do „Moich zgłoszeń” stoi na ekranie ZAWSZE - także przy błędzie", async () => {
    h.pobierz.mockRejectedValue(new Error("unknown"));
    renderWithQueryClient(<MyEventsPanel />);

    await screen.findByText("myEvents.loadError");
    const link = screen.getByRole("link", { name: "myEvents.manageTickets" });
    expect(link.getAttribute("href")).toBe("/profile/tickets");
  });
});

describe("MyEventsPanel - domyślna zakładka", () => {
  it("gdy wydarzenie TRWA, ekran otwiera się na „bieżących”", async () => {
    h.pobierz.mockResolvedValue([
      zapis({ eventStartsAt: zaIle(-2 * GODZINA), eventEndsAt: zaIle(2 * GODZINA) }),
    ]);
    renderWithQueryClient(<MyEventsPanel />);

    const zakladki = await screen.findByTestId("zakladki");
    expect(zakladki.getAttribute("data-domyslna")).toBe("current");
    expect(within(zakladki).getByText("Kongres CEE 2026")).toBeTruthy();
  });

  it("gdy nic nie trwa, ekran otwiera się na „nadchodzących”", async () => {
    renderWithQueryClient(<MyEventsPanel />);

    const zakladki = await screen.findByTestId("zakladki");
    expect(zakladki.getAttribute("data-domyslna")).toBe("upcoming");
  });

  it("przełączenie na „minione” pokazuje ZDANIE tej zakładki, a nie zdanie sąsiedniej", async () => {
    renderWithQueryClient(<MyEventsPanel />);

    await screen.findByTestId("zakladki");
    fireEvent.click(screen.getByRole("tab", { name: "myEvents.tabs.past" }));

    await waitFor(() => expect(screen.getByText("myEvents.emptyPast")).toBeTruthy());
    expect(screen.queryByText("myEvents.emptyUpcoming")).toBeNull();
  });

  it("wydarzenie sprzed roku ląduje w „minionych”, a nie w „nadchodzących”", async () => {
    h.pobierz.mockResolvedValue([
      zapis({ eventStartsAt: zaIle(-365 * DOBA), eventEndsAt: zaIle(-364 * DOBA) }),
    ]);
    renderWithQueryClient(<MyEventsPanel />);

    await screen.findByText("myEvents.emptyUpcoming");
    fireEvent.click(screen.getByRole("tab", { name: "myEvents.tabs.past" }));

    await waitFor(() => expect(screen.getByText("Kongres CEE 2026")).toBeTruthy());
  });
});

describe("MyEventsPanel - wiersz zgłoszenia", () => {
  it("nieopłacone zgłoszenie dostaje DROGĘ DO KASY, a nie samą plakietkę", async () => {
    h.pobierz.mockResolvedValue([
      zapis({ paymentStatus: "unpaid", orderStatus: "pending", paidAt: null }),
    ]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.unpaid")).toBeTruthy();
    const kasa = screen.getByRole("link", { name: /myEvents\.payNow/ });
    // Przycisk prowadzi na stronę TEGO wydarzenia; kotwicę `#tickets` niesie
    // osobna właściwość routera, której wspólna atrapa `<Link>` nie przepisuje
    // do `href` - dowód na sam adres docelowy zostaje tu, dowód na kotwicę
    // należy do testu strony wydarzenia.
    expect(kasa.getAttribute("href")).toBe("/events/kongres-cee");
    expect(screen.queryByText("myEvents.paid")).toBeNull();
  });

  it("opłacone zgłoszenie NIE pokazuje przycisku zapłaty", async () => {
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.paid")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /myEvents\.payNow/ })).toBeNull();
  });

  it("zapis bezpłatny ma WŁASNĄ plakietkę - zero nie jest długiem", async () => {
    h.pobierz.mockResolvedValue([
      zapis({ amountCents: 0, paymentStatus: null, orderStatus: null, paidAt: null }),
    ]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.free")).toBeTruthy();
    expect(screen.queryByText("myEvents.unpaid")).toBeNull();
    expect(screen.queryByRole("link", { name: /myEvents\.payNow/ })).toBeNull();
  });

  it("zgłoszenie bez kwoty (starszy backend) też jest bezpłatne, a nie zadłużone", async () => {
    h.pobierz.mockResolvedValue([zapis({ amountCents: null, paymentStatus: null })]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.free")).toBeTruthy();
  });

  it("oba odnośniki wiersza prowadzą do SLUGU TEGO wydarzenia", async () => {
    h.pobierz.mockResolvedValue([zapis({ eventSlug: "forum-baltyckie" })]);
    renderWithQueryClient(<MyEventsPanel />);

    const wiersz = await screen.findByRole("listitem");
    expect(
      within(wiersz).getByRole("link", { name: "myEvents.openEvent" }).getAttribute("href"),
    ).toBe("/events/forum-baltyckie");
    expect(
      within(wiersz).getByRole("link", { name: "myEvents.myPanel" }).getAttribute("href"),
    ).toBe("/events/forum-baltyckie/me");
  });

  it("brak tytułu w obu językach cofa się do SLUGU, a nie do pustego wiersza", async () => {
    h.pobierz.mockResolvedValue([zapis({ eventTitlePl: null, eventTitleEn: null })]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("kongres-cee")).toBeTruthy();
  });

  it("angielski interfejs bierze angielski tytuł wydarzenia", async () => {
    h.jezyk.current = "en";
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("CEE Congress 2026")).toBeTruthy();
    expect(screen.queryByText("Kongres CEE 2026")).toBeNull();
  });

  it("wydarzenie bez ustalonego terminu mówi to WPROST i zostaje w nadchodzących", async () => {
    h.pobierz.mockResolvedValue([zapis({ eventStartsAt: null, eventEndsAt: null })]);
    renderWithQueryClient(<MyEventsPanel />);

    expect(await screen.findByText("myEvents.noDate")).toBeTruthy();
    const zakladki = screen.getByTestId("zakladki");
    expect(zakladki.getAttribute("data-domyslna")).toBe("upcoming");
  });

  it("wydarzenie z terminem pokazuje datę, a nie zdanie o jej braku", async () => {
    renderWithQueryClient(<MyEventsPanel />);

    const wiersz = await screen.findByRole("listitem");
    expect(within(wiersz).queryByText("myEvents.noDate")).toBeNull();
    expect(wiersz.textContent).toMatch(/\d{4}/);
  });
});

describe("MyEventsPanel - dostępność", () => {
  it("lista wydarzeń nie ma naruszeń axe", async () => {
    h.pobierz.mockResolvedValue([
      zapis(),
      zapis({
        registrationId: "44444444-4444-4444-8444-444444444444",
        eventSlug: "forum-baltyckie",
        eventTitlePl: "Forum Bałtyckie",
        paymentStatus: "unpaid",
        orderStatus: "pending",
        paidAt: null,
      }),
    ]);
    const { container } = renderWithQueryClient(<MyEventsPanel />);

    await screen.findByText("Forum Bałtyckie");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });

  it("ekran błędu nie ma naruszeń axe", async () => {
    h.pobierz.mockRejectedValue(new Error("unknown"));
    const { container } = renderWithQueryClient(<MyEventsPanel />);

    await screen.findByText("myEvents.loadError");
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
