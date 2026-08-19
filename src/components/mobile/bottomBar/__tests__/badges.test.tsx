// Liczniki przy ikonach dolnego paska: cztery odznaki + ich leniwy nośnik.
// Wszystkie pięć plików na 0% do 18.08.2026, przy `config.ts` na 98% - czyli
// reguły paska były pod asercją, a jedyna rzecz, którą użytkownik widzi jako
// ZMIANĘ STANU (czerwona pigułka z liczbą), nie miała żadnej.
//
// Trzy rzeczy, których nie pilnuje nic innego:
//   1. próg wyświetlania: 0 to BRAK odznaki, nie „0" w kółku,
//   2. sufit: powyżej 99 pokazujemy „99+", żeby pigułka nie rozjechała ikony,
//   3. GOŚĆ nie pobiera ani bajta warstwy czatu/sieci/klubów - `LiveTabBadge`
//      jest w chunku wejściowym KAŻDEJ strony, także dla anonima.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@/lib/i18n";
import "@/lib/i18n-mobile-bottom-bar";
import { realT } from "@/test/i18nReal";

const data = vi.hoisted(() => ({
  chatUnread: 0,
  networkCounts: null as { pending_in: number; pending_out?: number } | null,
  notifications: undefined as number | undefined,
  clubUnread: 0,
  user: null as { id: string } | null,
}));

vi.mock("@/lib/chat/useConversations", () => ({
  useChatUnreadTotal: () => data.chatUnread,
}));
vi.mock("@/lib/network/useConnections", () => ({
  useNetworkCounts: () => ({ data: data.networkCounts }),
}));
vi.mock("@/lib/notifications/useNotifications", () => ({
  useUnreadCount: () => ({ data: data.notifications }),
}));
vi.mock("@/lib/counters/usePendingCounters", () => ({
  useUserCounter: (key: string) => (key === "club_unread" ? data.clubUnread : 0),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: data.user, session: data.user ? { user: data.user } : null }),
}));

const { ChatUnreadBadge } = await import("../badges/ChatUnreadBadge");
const { NetworkPendingBadge } = await import("../badges/NetworkPendingBadge");
const { NotificationsUnreadBadge } = await import("../badges/NotificationsUnreadBadge");
const { ClubUnreadBadge } = await import("../badges/ClubUnreadBadge");
const { LiveTabBadge } = await import("../LiveTabBadge");

const t = realT("pl");

beforeEach(() => {
  data.chatUnread = 0;
  data.networkCounts = null;
  data.notifications = undefined;
  data.clubUnread = 0;
  data.user = { id: "u1" };
});

afterEach(cleanup);

describe("progi licznika (wspólne dla wszystkich czterech odznak)", () => {
  it("zero NIE rysuje odznaki - pusta pigułka wygląda jak błąd renderu", () => {
    data.chatUnread = 0;
    const { container } = render(<ChatUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("liczby 1..99 pokazujemy dokładnie", () => {
    data.chatUnread = 1;
    const { unmount } = render(<ChatUnreadBadge />);
    expect(screen.getByText("1")).toBeTruthy();
    unmount();

    data.chatUnread = 99;
    render(<ChatUnreadBadge />);
    expect(screen.getByText("99")).toBeTruthy();
  });

  it("od 100 w górę wchodzi „99+” - inaczej pigułka rozjeżdża ikonę", () => {
    data.chatUnread = 100;
    const { unmount } = render(<ChatUnreadBadge />);
    expect(screen.getByText("99+")).toBeTruthy();
    unmount();

    data.chatUnread = 4321;
    render(<ChatUnreadBadge />);
    expect(screen.getByText("99+")).toBeTruthy();
  });

  it("wartość ujemna (licznik rozjechany w bazie) też nic nie rysuje", () => {
    data.chatUnread = -3;
    const { container } = render(<ChatUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("odznaka czatu", () => {
  it("czyta sumę nieprzeczytanych i opisuje ją po polsku", () => {
    data.chatUnread = 5;
    render(<ChatUnreadBadge />);
    expect(screen.getByLabelText(t("mobileBottomBar.unreadChat", { count: 5 }))).toBeTruthy();
  });

  it("zmiana ogłasza się czytnikowi ekranu na bieżąco", () => {
    data.chatUnread = 2;
    render(<ChatUnreadBadge />);
    expect(screen.getByText("2")).toHaveAttribute("aria-live", "polite");
  });
});

describe("odznaka sieci kontaktów", () => {
  it("liczy WYŁĄCZNIE zaproszenia przychodzące", () => {
    // Zaproszenie wysłane przez użytkownika nie jest zadaniem do wykonania,
    // więc nie ma prawa zapalać plakietki.
    data.networkCounts = { pending_in: 3, pending_out: 9 };
    render(<NetworkPendingBadge />);
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("brak odpowiedzi zapytania czyta jako zero, nie jako błąd", () => {
    // Zapytanie mogło się nie powieść albo jeszcze nie wrócić - pasek ma
    // wyglądać tak samo jak przy zerze, a nie migać pustą pigułką.
    data.networkCounts = null;
    const { container } = render(<NetworkPendingBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("odznaka powiadomień", () => {
  it("pokazuje liczbę nieprzeczytanych", () => {
    data.notifications = 7;
    render(<NotificationsUnreadBadge />);
    expect(screen.getByText("7")).toBeTruthy();
    expect(
      screen.getByLabelText(t("mobileBottomBar.unreadNotifications", { count: 7 })),
    ).toBeTruthy();
  });

  it("brak danych to zero", () => {
    data.notifications = undefined;
    const { container } = render(<NotificationsUnreadBadge />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("odznaka klubów", () => {
  it("czyta zmaterializowany licznik, nie sumę po członkostwach", () => {
    data.clubUnread = 12;
    render(<ClubUnreadBadge />);
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByLabelText(t("mobileBottomBar.unreadClubs", { count: 12 }))).toBeTruthy();
  });
});

describe("LiveTabBadge - nośnik licznika", () => {
  it("GOŚĆ nie dostaje licznika (i nie dociąga jego warstwy danych)", () => {
    // To jest cała racja bytu leniwego ładowania: `<MobileBottomBar />` siedzi
    // w chunku wejściowym każdej strony, którym płaci też anonimowy czytelnik.
    data.user = null;
    const { container } = render(<LiveTabBadge source="chat" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pozycja bez podpiętego licznika nic nie renderuje", () => {
    const { container } = render(<LiveTabBadge source="none" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("brak deklaracji źródła też nic nie renderuje", () => {
    const { container } = render(<LiveTabBadge source={undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("zalogowany dostaje licznik z podpiętego źródła", async () => {
    data.chatUnread = 4;
    render(<LiveTabBadge source="chat" />);
    // Komponent odznaki jest ładowany leniwie - fallback Suspense jest pusty,
    // więc liczba pojawia się dopiero po dojechaniu modułu.
    expect(await screen.findByText("4")).toBeTruthy();
  });

  it("każde źródło prowadzi do WŁASNEJ odznaki", async () => {
    data.networkCounts = { pending_in: 2 };
    data.notifications = 6;
    data.clubUnread = 8;

    const network = render(<LiveTabBadge source="network" />);
    expect(await screen.findByText("2")).toBeTruthy();
    network.unmount();

    const notifications = render(<LiveTabBadge source="notifications" />);
    expect(await screen.findByText("6")).toBeTruthy();
    notifications.unmount();

    render(<LiveTabBadge source="clubs" />);
    expect(await screen.findByText("8")).toBeTruthy();
  });

  it("licznik dostaje klasę kotwiczącą go przy ikonie", async () => {
    // Pigułka jest pozycjonowana absolutnie względem `.mbb__iconwrap` -
    // bez tej klasy ląduje w toku tekstu i rozpycha pozycję paska.
    data.clubUnread = 3;
    render(<LiveTabBadge source="clubs" />);
    expect(await screen.findByText("3")).toHaveClass("mbb__badge");
  });
});
