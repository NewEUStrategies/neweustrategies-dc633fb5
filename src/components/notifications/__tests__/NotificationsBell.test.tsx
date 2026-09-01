// Dzwonek powiadomień w nagłówku - 10/27 funkcji i 45,4% gałęzi przed tym
// plikiem.
//
// CO TU JEST RYZYKIEM. Dzwonek renderuje się w chrome KAŻDEJ strony, a jego
// wiersz jest jedynym miejscem w produkcie, gdzie treść z bazy (`href`)
// steruje nawigacją. Stąd trzy rodziny dowodów:
//
//   1. NAWIGACJA SPA Z ZACHOWANIEM QUERY STRINGU. Wiersz jest prawdziwą
//      kotwicą `<a href>`, ale niemodyfikowany klik lewym przyciskiem
//      przechwytujemy na `router.navigate({ href })`. To NIE jest
//      `<Link to={href}>` świadomie: `to` traktuje wartość jako czystą
//      ścieżkę i gubi `?search`, przez co „/messages?c=<uuid>" kończyło się
//      404 na pustej rozmowie. Test MUSI więc jechać na hrefie z query
//      stringiem i sprawdzać, że parametr przeżył - asercja na samej ścieżce
//      przeszłaby także dla zepsutej wersji.
//   2. KLIK Z MODYFIKATOREM. Ctrl/Cmd/Shift/Alt i środkowy przycisk zostają
//      przy natywnym zachowaniu kotwicy („otwórz w nowej karcie"). Odebranie
//      im `preventDefault` jest tym rodzajem regresji, której nie widać
//      w zwykłym klikaniu - a która kasuje jedyny sposób otwarcia
//      powiadomienia obok bieżącej pracy.
//   3. REFCOUNT KANAŁU REALTIME. `useNotificationsRealtime` idzie przez
//      współdzielony `tableChannelHub` z licznikiem referencji na poziomie
//      MODUŁU. Zgubiony `removeChannel` nie psuje widoku od razu - dopiero po
//      kilku przejściach między trasami kończy się limit kanałów i zdarzenia
//      przestają przychodzić. Dlatego `removed === true` i pusty
//      `liveChannels("hub:")` są tu ASERCJĄ, nie dekoracją.
//
// CZEGO TEN PLIK ŚWIADOMIE NIE DUBLUJE. Predykaty odnośnika
// (`isInternalHref`, `isPlainLeftClick`, `notificationActorId`), selektory
// tekstu (`pickTitle`, `pickBody`, `relTime`) i rozpoznanie kluczy cache mają
// własne testy jednostkowe w `src/lib/notifications/__tests__/` - tutaj
// dowodzimy SKLEJENIA: że dzwonek woła je na właściwych danych i respektuje
// wynik.
//
// Dane są ZMYŚLONE i takie mają zostać (powierzchnia RODO-wrażliwa): adresy
// wyłącznie z example.org, identyfikatory z zakresu testowego.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { Database } from "@/integrations/supabase/types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const TENANT_ID = "00000000-0000-4000-8000-0000000000bb";
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
/** Adres z QUERY STRINGIEM - cały sens testu nawigacji SPA. */
const CONVERSATION_HREF = `/messages?c=${CONVERSATION_ID}`;

// ---------------------------------------------------------------------------
// STAN ATRAP. `vi.hoisted`, bo fabryki `vi.mock` biegną przed importami.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  userId: null as string | null,
  authLoading: false,
  db: null as null | { from: (table: string) => unknown },
  rpc: null as null | { rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown> },
  realtime: null as null | { channel: unknown; removeChannel: unknown },
  navigate: vi.fn<(options: { href: string }) => Promise<void>>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (!h.db) throw new Error("test: atrapa `from` nie została zainicjalizowana");
      return h.db.from(table);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      if (!h.rpc) throw new Error("test: atrapa `rpc` nie została zainicjalizowana");
      return h.rpc.rpc(name, args);
    },
    channel: (name: string, config?: Record<string, unknown>) => {
      if (!h.realtime) throw new Error("test: atrapa kanałów nie została zainicjalizowana");
      const create = h.realtime.channel;
      if (typeof create !== "function") throw new Error("test: `channel` nie jest funkcją");
      return create(name, config);
    },
    removeChannel: (channel: unknown) => {
      if (!h.realtime) throw new Error("test: atrapa kanałów nie została zainicjalizowana");
      const remove = h.realtime.removeChannel;
      if (typeof remove !== "function") throw new Error("test: `removeChannel` nie jest funkcją");
      return remove(channel);
    },
  },
}));

/**
 * Atrapa sesji w kształcie, którego dotyka warstwa danych powiadomień:
 * `user` (klucz cache + filtr kanału) i `loading` (bramka „nie strzelaj
 * zapytaniem przed domknięciem handshake'u sesji").
 */
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.userId ? { id: h.userId } : null,
    session: h.userId ? { access_token: "t" } : null,
    roles: [],
    tenantId: h.userId ? TENANT_ID : null,
    loading: h.authLoading,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));

// `react-i18next` NIE JEST atrapowany. `@/lib/i18n` robi
// `i18n.use(initReactI18next).init(...)`, więc `useTranslation()` bez providera
// czyta PRAWDZIWĄ instancję aplikacji - te same napisy, które zobaczy
// użytkownik, i asercja gaśnie, gdy klucz zniknie ze słownika. Udokumentowany
// w `i18nReal.ts` skrót `vi.mock("react-i18next", () => reactI18nextMock())`
// ZAKLESZCZA ten plik: fabryka mocka sięga po `@/lib/i18n`, a ten importuje
// właśnie mockowany moduł (ten sam powód opisują `SavedSearchesPanel.test.tsx`
// i `AdminDonations.test.tsx`). Import `@/test/i18nReal` niżej dociąga OBA
// rdzenie językowe, zanim ruszy pierwszy render.

/**
 * Router: podmieniamy WYŁĄCZNIE dwa wiązania, których dzwonek używa.
 * `useRouter().navigate` jest przedmiotem dowodu (dokąd prowadzi wiersz),
 * a `<Link>` czyta kontekst routera i bez `RouterProvider` rzuca - wspólna
 * atrapa `@/test/routerLinkStub` renderuje w jego miejsce dostępną kotwicę.
 */
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return {
    ...actual,
    Link: RouterLinkStub,
    useRouter: () => ({ navigate: h.navigate }),
  };
});

import { ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { realtimeStub, type FakeChannel, type RealtimeStub } from "@/test/supabase/realtime";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import { NotificationsBell } from "../NotificationsBell";

const t = realT("pl");

// ---------------------------------------------------------------------------
// FIXTURE'Y.
// ---------------------------------------------------------------------------

function notif(over: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: "n-1",
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    kind: "system",
    title_pl: "Powiadomienie testowe",
    title_en: null,
    body_pl: null,
    body_en: null,
    href: null,
    icon: null,
    read_at: null,
    created_at: "2026-08-20T10:00:00.000Z",
    ...over,
  };
}

/** Dwa nieprzeczytane wiersze TEJ SAMEJ rozmowy - zwijają się w jedną grupę. */
const CONVERSATION_ROWS: NotificationRow[] = [
  notif({
    id: "n-msg-2",
    kind: "message",
    href: CONVERSATION_HREF,
    title_pl: "Anna Testowa",
    body_pl: "Druga wiadomość",
    created_at: "2026-08-20T12:00:00.000Z",
  }),
  notif({
    id: "n-msg-1",
    kind: "message",
    href: CONVERSATION_HREF,
    title_pl: "Anna Testowa",
    body_pl: "Pierwsza wiadomość",
    created_at: "2026-08-20T11:00:00.000Z",
  }),
];

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let rt: RealtimeStub;
let rows: NotificationRow[] = [];
let unreadCount = 0;

/** STRAŻNIK, nie rzutowanie - kanał atrapy ma obserwowalny `subscribeCount`. */
function isFakeChannel(value: unknown): value is FakeChannel {
  return (
    typeof value === "object" && value !== null && "subscribeCount" in value && "listeners" in value
  );
}

beforeEach(() => {
  // Odmontowanie POPRZEDNIEGO drzewa musi się wydarzyć zanim podmienimy
  // atrapy: hub kanałów ma stan modułowy z refcountem, więc kanał zwolniony
  // po zamianie atrapy zostałby policzony w nowej instancji.
  cleanup();
  expect(activeChannelCount()).toBe(0);

  db = supabaseFromStub();
  rpc = supabaseRpcStub();
  rt = realtimeStub();
  h.db = { from: (table: string) => db.from(table) };
  h.rpc = { rpc: (name, args) => rpc.rpc(name, args) };
  h.realtime = {
    channel: (name: string, config?: Record<string, unknown>) => rt.channel(name, config),
    removeChannel: (channel: unknown) => {
      if (!isFakeChannel(channel)) throw new Error("test: usuwany kanał nie jest kanałem atrapy");
      return rt.removeChannel(channel);
    },
  };
  h.userId = USER_ID;
  h.authLoading = false;
  h.navigate.mockReset();
  h.navigate.mockResolvedValue(undefined);

  rows = [];
  unreadCount = 0;

  // Lista + operacje zbiorcze na tabeli `notifications` idą tym samym
  // łańcuchem, więc responder rozróżnia je po wywołanym ogniwie.
  db.setResponse("notifications", (chain) => (chain.has("select") ? ok(rows) : ok(null)));
  db.setResponse("user_pending_counters", () => ok({ value: unreadCount }));
  db.setResponse("notification_preferences", () => ok(DEFAULT_NOTIFICATION_PREFERENCES));
  // Profile aktorów: puste zbiory to poprawna odpowiedź (rozmówca spoza sieci
  // kontaktów), wtedy wiersz pokazuje ikonę rodzaju zamiast awatara.
  rpc.setData("my_connections", []);
  rpc.setData("my_connection_requests", []);
  rpc.setData("mark_notifications_read", 2);
  rpc.setData("mark_notification_unread", 1);
});

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Dzwonek z ZAKOŃCZONYM pierwszym odczytem listy. */
async function mountBell() {
  const utils = withClient(<NotificationsBell />);
  await waitFor(() => expect(db.chainsFor("notifications").length).toBeGreaterThan(0));
  await act(async () => {});
  return utils;
}

const trigger = () => screen.getByRole("button", { name: t("notifications.title") });

/** Otwarcie panelu - Radix Popover reaguje na `click` wyzwalacza. */
async function openBell() {
  fireEvent.click(trigger());
  return screen.findByText(t("notifications.openInbox"));
}

/**
 * Klik w kotwicę ZEWNĘTRZNĄ bez wychodzenia do sieci.
 *
 * happy-dom wykonuje domyślną akcję kotwicy z adresem absolutnym, czyli
 * REALNE żądanie HTTP (w przebiegu bez tej ochrony w logu widać
 * `GET https://example.org/... 403`). Testy tego repo nie chodzą do sieci,
 * więc domyślną akcję kasujemy nasłuchem na dokumencie w fazie
 * przechwytywania. Handler komponentu i tak biegnie (React słucha na
 * kontenerze roota), a jedyną gałęzią czytającą `defaultPrevented` jest
 * ścieżka WEWNĘTRZNA - której ten test nie dotyczy.
 */
function clickWithoutNavigation(element: Element): void {
  const cancel = (event: Event) => event.preventDefault();
  document.addEventListener("click", cancel, true);
  try {
    fireEvent.click(element);
  } finally {
    document.removeEventListener("click", cancel, true);
  }
}

describe("NotificationsBell - sesja i licznik", () => {
  it("bez sesji renderuje null i NIE zakłada żadnego kanału", () => {
    // Hooki realtime są wołane BEZWARUNKOWO, przed `if (!user) return null` -
    // kolejność hooków musi być stała między renderami i ta kolejność jest tu
    // świadoma (komentarz w komponencie mówi to wprost). Dowód dotyczy więc
    // EFEKTU, nie wywołania: obie subskrypcje wychodzą wcześnie przy braku
    // `uid`, więc pusty `channels` jest jedyną obserwowalną konsekwencją.
    h.userId = null;
    const { container } = withClient(<NotificationsBell />);
    expect(container).toBeEmptyDOMElement();
    expect(rt.channels).toHaveLength(0);
  });

  it("odznaka pokazuje liczbę nieprzeczytanych, gdy jest większa od zera", async () => {
    unreadCount = 3;
    await mountBell();
    // Etykieta odznaki jedzie przez formy mnogie - to jedyne miejsce, w którym
    // widać, że licznik NIE jest gołą cyfrą bez znaczenia dla czytnika ekranu.
    // `findBy*`, bo licznik jedzie OSOBNYM zapytaniem niż lista (zmaterializowany
    // `user_pending_counters`) i osiada o jeden obieg mikrozadań później.
    expect(
      await within(trigger()).findByLabelText(t("notifications.unread", { count: 3 })),
    ).toHaveTextContent("3");
  });

  it("przy zerze nie ma odznaki, a „oznacz wszystkie” jest zablokowane", async () => {
    unreadCount = 0;
    await mountBell();
    expect(within(trigger()).queryByLabelText(/nieprzeczyt/i)).toBeNull();
    await openBell();
    expect(screen.getByRole("button", { name: t("notifications.markAllRead") })).toBeDisabled();
  });

  it("„oznacz wszystkie” przy niezerowym liczniku wysyła zapis do tabeli", async () => {
    unreadCount = 2;
    rows = CONVERSATION_ROWS;
    await mountBell();
    await openBell();
    const markAll = screen.getByRole("button", { name: t("notifications.markAllRead") });
    expect(markAll).toBeEnabled();
    fireEvent.click(markAll);
    // Zapis idzie łańcuchem `update().eq(user_id).is(read_at, null)` - filtr
    // `is` jest tu treścią zachowania: bez niego zapis przestemplowałby także
    // wiersze już przeczytane i zgubił ich pierwotny znacznik czasu.
    await waitFor(() => {
      const update = db.chainsFor("notifications").find((c) => c.has("update"));
      expect(update).toBeDefined();
      expect(update?.argsOf("is")).toEqual(["read_at", null]);
    });
  });

  it("pusta lista pokazuje komunikat o braku powiadomień", async () => {
    await mountBell();
    await openBell();
    expect(screen.getByText(t("notifications.empty"))).toBeInTheDocument();
  });
});

describe("NotificationsBell - nawigacja z wiersza", () => {
  it("klik w odnośnik WEWNĘTRZNY nawiguje przez router i ZACHOWUJE query string", async () => {
    unreadCount = 2;
    rows = CONVERSATION_ROWS;
    await mountBell();
    await openBell();

    const link = screen.getByRole("link", {
      name: new RegExp(t("notifications.grouped.messagesFrom", { name: "Anna Testowa" })),
    });
    expect(link).toHaveAttribute("href", CONVERSATION_HREF);
    // `fireEvent` zwraca false, gdy zdarzenie zostało anulowane - to jedyny
    // sposób zobaczenia `preventDefault()` bez zaglądania do implementacji.
    expect(fireEvent.click(link)).toBe(false);

    // Sedno: `?c=<uuid>` MUSI dojechać do routera. `<Link to={href}>` gubiłby
    // ten człon i użytkownik lądowałby na pustej liście rozmów.
    expect(h.navigate).toHaveBeenCalledWith({ href: CONVERSATION_HREF });
  });

  it("klik w wiersz oznacza WSZYSTKIE nieprzeczytane grupy i zamyka panel", async () => {
    unreadCount = 2;
    rows = CONVERSATION_ROWS;
    await mountBell();
    await openBell();

    fireEvent.click(
      screen.getByRole("link", {
        name: new RegExp(t("notifications.grouped.messagesFrom", { name: "Anna Testowa" })),
      }),
    );

    // Grupa zwija DWA wiersze - wysłanie samego najnowszego zostawiłoby drugi
    // jako nieprzeczytany i licznik w nagłówku „czasem by się nie zgadzał".
    await waitFor(() => expect(rpc.lastCall("mark_notifications_read")).toBeDefined());
    expect(rpc.lastCall("mark_notifications_read")?.arg("p_ids")).toEqual(["n-msg-2", "n-msg-1"]);
    await waitFor(() => expect(screen.queryByText(t("notifications.openInbox"))).toBeNull());
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["alt", { altKey: true }],
    ["środkowy przycisk", { button: 1 }],
  ])("klik z modyfikatorem (%s) zostawia natywne zachowanie kotwicy", async (_name, init) => {
    rows = CONVERSATION_ROWS;
    await mountBell();
    await openBell();

    const link = screen.getByRole("link", {
      name: new RegExp(t("notifications.grouped.messagesFrom", { name: "Anna Testowa" })),
    });
    // Brak `preventDefault` (zwrot true) ORAZ brak nawigacji SPA - dopiero
    // oba naraz znaczą „otwórz w nowej karcie działa".
    expect(fireEvent.click(link, init)).toBe(true);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("odnośnik ZEWNĘTRZNY renderuje kotwicę z target=_blank i rel=noopener noreferrer", async () => {
    rows = [
      notif({
        id: "n-ext",
        kind: "content",
        href: "https://example.org/raport-kwartalny",
        title_pl: "Raport kwartalny",
      }),
    ];
    await mountBell();
    await openBell();

    const link = screen.getByRole("link", { name: /Raport kwartalny/ });
    expect(link).toHaveAttribute("target", "_blank");
    // `noopener` odcina dostęp do `window.opener`, `noreferrer` - wyciek
    // adresu skrzynki w nagłówku Referer. Treść `href` pochodzi z bazy, więc
    // oba są tu regułą bezpieczeństwa, nie kosmetyką.
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    clickWithoutNavigation(link);
    // Adres zewnętrzny NIE może przejść przez router SPA - `navigate({ href })`
    // z obcym hostem to nawigacja w obrębie aplikacji na cudzy adres.
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("wiersz BEZ odnośnika renderuje przycisk, nie kotwicę", async () => {
    rows = [notif({ id: "n-sys", title_pl: "Przerwa techniczna", href: null })];
    await mountBell();
    await openBell();

    // Kotwica bez `href` jest dla klawiatury i czytnika ekranu niewidoczna -
    // wiersz, którego jedyną akcją jest oznaczenie i zamknięcie panelu, musi
    // być przyciskiem.
    expect(screen.getByRole("button", { name: /Przerwa techniczna/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Przerwa techniczna/ })).toBeNull();
  });
});

describe("NotificationsBell - akcje wiersza zatrzymują propagację", () => {
  it("„oznacz przeczytane” nie nawiguje i nie zamyka panelu", async () => {
    unreadCount = 2;
    rows = CONVERSATION_ROWS;
    await mountBell();
    await openBell();

    fireEvent.click(screen.getByRole("button", { name: t("notifications.markRead") }));

    // Bez `stopPropagation` klik w ikonę „przeczytane" wypłynąłby na kotwicę
    // wiersza i przeniósł użytkownika do rozmowy - czyli akcja „zostaw na
    // później" robiłaby dokładnie to, czego użytkownik uniknął.
    await waitFor(() => expect(rpc.callsFor("mark_notifications_read")).toHaveLength(1));
    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.getByText(t("notifications.openInbox"))).toBeInTheDocument();
  });

  it("„oznacz nieprzeczytane” woła RPC pojedynczego wiersza i nie nawiguje", async () => {
    rows = [
      notif({
        id: "n-read",
        kind: "message",
        href: CONVERSATION_HREF,
        title_pl: "Anna Testowa",
        read_at: "2026-08-20T12:30:00.000Z",
      }),
    ];
    await mountBell();
    await openBell();

    fireEvent.click(screen.getByRole("button", { name: t("notifications.markUnread") }));

    await waitFor(() => expect(rpc.lastCall("mark_notification_unread")).toBeDefined());
    expect(rpc.lastCall("mark_notification_unread")?.arg("p_id")).toBe("n-read");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(screen.getByText(t("notifications.openInbox"))).toBeInTheDocument();
  });
});

describe("NotificationsBell - realtime", () => {
  it("zakłada JEDEN kanał na tabelę, filtrowany po użytkowniku", async () => {
    await mountBell();
    const channel = rt.channelByPrefix("hub:public|notifications|");
    expect(channel).toBeDefined();
    // Filtr po `user_id` to optymalizacja pasma (izolację i tak wymusza RLS),
    // ale jego zgubienie zamienia kanał w firehose całego najemcy.
    expect(channel?.listeners[0]?.filter).toMatchObject({
      table: "notifications",
      filter: `user_id=eq.${USER_ID}`,
    });
    expect(channel?.subscribeCount).toBe(1);
  });

  it("zdarzenie INSERT odświeża dzwonek (nowy wiersz i licznik)", async () => {
    unreadCount = 0;
    rows = [];
    await mountBell();
    await openBell();
    expect(screen.getByText(t("notifications.empty"))).toBeInTheDocument();

    // Serwer „dostaje" nowy wiersz, po czym rozgłasza zdarzenie. Test mierzy
    // to, co widzi użytkownik: unieważnienie cache musi doprowadzić do
    // ponownego odczytu, a nie tylko przemielić zdarzenie.
    rows = [notif({ id: "n-nowe", title_pl: "Nowe zaproszenie", kind: "connection" })];
    unreadCount = 1;
    const channel = rt.channelByPrefix("hub:public|notifications|");
    await act(async () => {
      channel?.emitPostgres("notifications", {
        eventType: "INSERT",
        new: { id: "n-nowe", kind: "connection" },
      });
    });

    expect(await screen.findByText("Nowe zaproszenie")).toBeInTheDocument();
  });

  it("ODMONTOWANIE zwalnia kanały - refcount wraca do zera", async () => {
    const { unmount } = await mountBell();
    const notifChannel = rt.channelByPrefix("hub:public|notifications|");
    const prefsChannel = rt.channelByPrefix("hub:public|notification_preferences|");
    expect(rt.liveChannels("hub:")).toHaveLength(2);

    act(() => unmount());

    // Gubiony `removeChannel` nie psuje widoku od razu - dopiero po kilku
    // przejściach między trasami kończy się limit kanałów Realtime i dzwonek
    // przestaje dostawać zdarzenia. Dlatego dowód jest na refcount, nie na
    // wyglądzie ekranu.
    expect(notifChannel?.removed).toBe(true);
    expect(prefsChannel?.removed).toBe(true);
    expect(rt.liveChannels("hub:")).toHaveLength(0);
    expect(activeChannelCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ. Radix renderuje treść panelu w PORTALU (poza `container`
// z `render`), więc axe dostaje całe `document.body` - inaczej oglądałby sam
// wyzwalacz i „przechodziłby" na dwóch węzłach.
// ---------------------------------------------------------------------------

/** Znane, ZGŁOSZONE niżej defekty - lista zamknięta, żeby nowe nie wsiąkły. */
const ZNANE_DEFEKTY_A11Y = ["aria-dialog-name", "nested-interactive"];

async function panelViolationIds(): Promise<string[]> {
  const violations = await axeViolations(document.body);
  return violations.map((v) => v.id);
}

describe("NotificationsBell - dostępność", () => {
  it.fails(
    "DEFEKT: otwarty panel jest dialogiem BEZ nazwy - oczekiwany kontrakt: role=dialog ma aria-label (np. notifications.title)",
    async () => {
      // `PopoverContent` Radiksa nadaje warstwie `role="dialog"`, a dzwonek nie
      // podaje jej ani `aria-label`, ani `aria-labelledby`. Czytnik ekranu
      // ogłasza „okno dialogowe" bez informacji, CZYJE - a to jedyna warstwa
      // powiadomień w chrome aplikacji. Naprawa jest jednolinijkowa
      // (`aria-label={t("notifications.title")}` na `PopoverContent`), ale
      // mieszka w kodzie produkcyjnym, którego ten plik nie zmienia.
      rows = CONVERSATION_ROWS;
      await mountBell();
      await openBell();
      expect(await panelViolationIds()).not.toContain("aria-dialog-name");
    },
  );

  it.fails(
    "DEFEKT: wiersz BEZ odnośnika zagnieżdża przycisk w przycisku - oczekiwany kontrakt: akcje wiersza poza elementem klikalnym",
    async () => {
      // Wiersz bez `href` renderuje się jako `<button>` obejmujący CAŁY wiersz,
      // a w środku siedzą przyciski „oznacz przeczytane"/„oznacz
      // nieprzeczytane". WCAG 4.1.2: zagnieżdżonych kontrolek czytniki ekranu
      // nie ogłaszają, a nawigacja klawiaturą po nich jest nieprzewidywalna.
      // Wiersze z `href` (kotwica) tego naruszenia NIE wywołują - dlatego
      // fixture ma tu wyłącznie wiersz bezodnośnikowy, żeby dowód wskazywał
      // konkretną gałąź renderu.
      rows = [notif({ id: "n-sys", title_pl: "Przerwa techniczna", href: null })];
      await mountBell();
      await openBell();
      expect(await panelViolationIds()).not.toContain("nested-interactive");
    },
  );

  it("poza dwoma zgłoszonymi defektami otwarty panel nie ma naruszeń axe", async () => {
    // Ta asercja jest dopełnieniem dwóch `it.fails` powyżej: tamte pilnują, że
    // znane defekty NADAL istnieją (a więc opis ich nie przeżył naprawy), ta -
    // że nie doszło żadne nowe. Bez niej `it.fails` byłby workiem, w którym
    // zniknęłaby każda kolejna regresja dostępności tego panelu.
    unreadCount = 2;
    rows = [...CONVERSATION_ROWS, notif({ id: "n-sys", title_pl: "Przerwa techniczna" })];
    await mountBell();
    await openBell();

    const nowe = (await axeViolations(document.body)).filter(
      (violation) => !ZNANE_DEFEKTY_A11Y.includes(violation.id),
    );
    expect(nowe, summarize(nowe)).toEqual([]);
  });
});
