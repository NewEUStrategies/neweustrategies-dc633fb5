// Centrum powiadomień (skrzynka + ustawienia) - 0/146 linii i 0/64 funkcji
// przed tym plikiem, przy 812 liniach kodu.
//
// DLACZEGO TEN ORGANIZM TRZEBA RENDEROWAĆ, A NIE ROZBIĆ NA ASERCJE JEDNOSTKOWE.
// Czyste kawałki JUŻ z niego wyszły i mają własne testy: predykaty odnośnika
// (`notificationLink`), selektory tekstu (`notificationText`), rozpoznanie
// kluczy cache (`notificationListKeys`), katalog rodzajów (`preferences`)
// i grupowanie (`grouping`). To, co zostało, jest z definicji nierozłączne od
// renderu i cache'u React Query:
//
//   1. OPTYMISTYCZNA AKTUALIZACJA I COFNIĘCIE. Oznaczenie wiersza łata KAŻDY
//      zapisany w cache widok listy, a na widoku „Nieprzeczytane" wiersz ma
//      z niej ZNIKNĄĆ, nie zmienić stan. Błąd w tej warstwie nie wywala
//      niczego - objawia się jako „licznik nieprzeczytanych czasem się nie
//      zgadza", czyli zgłoszenie, którego nie da się odtworzyć.
//   2. AKCJE GRUPOWE NA ZWINIĘTEJ ROZMOWIE. Grupa reprezentuje wiele wierszy
//      jednym, więc do RPC musi pojechać KOMPLET identyfikatorów - osobno dla
//      oznaczenia i dla kosza. Tu ten plik znalazł żywy defekt (patrz sekcja
//      akcji grupowych i trzy `it.fails`).
//   3. REFCOUNT KANAŁÓW REALTIME. Subskrypcje idą przez współdzielony
//      `tableChannelHub` ze stanem MODUŁOWYM. Zgubiony `removeChannel` nie
//      psuje widoku od razu - dopiero po kilku przejściach między trasami
//      kończy się limit kanałów i zdarzenia przestają przychodzić.
//   4. CZTERY TRYBY (`full`/`inbox`/`preferences`/`consents`) sterujące tym,
//      KTÓRA powierzchnia jest w ogóle zamontowana.
//
// JAK CZYTAMY „PRZED ODPOWIEDZIĄ SERWERA". React Query woła `onMutate`
// asynchronicznie (pierwszy `await` w `Mutation.execute`), więc asercji
// „natychmiast po kliknięciu" nie da się postawić synchronicznie bez ścigania
// się z inwalidacją. Zamiast zgadywać moment, testy optymizmu BLOKUJĄ ODCZYT
// po mutacji (responder tabeli zaczyna zwracać błąd): React Query zachowuje
// wtedy ostatnie dane, więc to, co widać na ekranie po ustaniu ruchu, pochodzi
// WYŁĄCZNIE z łatki cache albo z jej cofnięcia - nigdy ze świeżego odczytu.
// Bez tego zabiegu ten sam test przechodziłby także dla wersji BEZ optymizmu,
// której wystarczyłaby inwalidacja.
//
// Dane są ZMYŚLONE (powierzchnia RODO-wrażliwa): adresy wyłącznie
// z example.org, identyfikatory z zakresu testowego.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { NodeResult, Result } from "axe-core";
import type { Database } from "@/integrations/supabase/types";

type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

const USER_ID = "00000000-0000-4000-8000-0000000000aa";
const TENANT_ID = "00000000-0000-4000-8000-0000000000bb";
const CONVERSATION_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_HREF = `/messages?c=${CONVERSATION_ID}`;

// ---------------------------------------------------------------------------
// STAN ATRAP. `vi.hoisted`, bo fabryki `vi.mock` biegną przed importami.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as null | { from: (table: string) => unknown },
  rpc: null as null | { rpc: (name: string, args?: Record<string, unknown>) => Promise<unknown> },
  realtime: null as null | { channel: unknown; removeChannel: unknown },
  navigate: vi.fn<(options: { href: string }) => Promise<void>>(),
  toasts: [] as { kind: "success" | "error"; text: string }[],
  pushSupported: true,
  vapidKey: "klucz-testowy" as string | null,
  enablePush: vi.fn<(userId: string) => Promise<void>>(),
  disablePush: vi.fn<() => Promise<void>>(),
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: h.userId ? { id: h.userId } : null,
    session: h.userId ? { access_token: "t" } : null,
    roles: [],
    tenantId: h.userId ? TENANT_ID : null,
    loading: false,
    isStaff: false,
    isAdmin: false,
    isSuperAdmin: false,
    signOut: async () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (text: string) => h.toasts.push({ kind: "success", text }),
    error: (text: string) => h.toasts.push({ kind: "error", text }),
  },
}));

// `react-i18next` NIE JEST atrapowany - `useTranslation()` czyta PRAWDZIWĄ
// instancję aplikacji (`@/lib/i18n` robi `use(initReactI18next).init`), więc
// asercje mierzą napis ze słownika i gasną, gdy klucz zniknie. Skrót
// `vi.mock("react-i18next", () => reactI18nextMock())` ZAKLESZCZYŁBY ten plik:
// fabryka mocka sięga po `@/lib/i18n`, a ten importuje właśnie mockowany moduł
// (ostrzeżenie z nagłówka `@/test/i18nReal`, powtórzone w `SavedSearchesPanel`
// i `AdminDonations`).

// Router: skrzynka używa wyłącznie `useRouter().navigate` (nawigacja SPA
// z wiersza), a `RouterProvider` nie jest jej do niczego innego potrzebny.
vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return { ...actual, useRouter: () => ({ navigate: h.navigate }) };
});

// Warstwa push dotyka przeglądarkowego Notification/ServiceWorker API, którego
// happy-dom nie ma. Atrapa oddaje DOKŁADNIE kontrakt, na którym stoi widok:
// dostępność (wsparcie + klucz VAPID) i rozróżnialny powód odmowy.
vi.mock("@/lib/notifications/push", () => ({
  isPushSupported: () => h.pushSupported,
  vapidPublicKey: async () => h.vapidKey,
  enablePushForThisBrowser: (userId: string) => h.enablePush(userId),
  disablePushForThisBrowser: () => h.disablePush(),
}));

// Panel zgód ma WŁASNY test - tutaj interesuje nas tylko to, czy tryb
// `consents` w ogóle go montuje (i czy nie montuje przy okazji skrzynki).
vi.mock("@/components/notifications/ConsentsPanel", () => ({
  ConsentsPanel: () => <div data-testid="consents-panel">panel zgód</div>,
}));

import { fail, ok, supabaseFromStub, type SupabaseFromStub } from "@/test/supabase/chain";
import { supabaseRpcStub, type SupabaseRpcStub } from "@/test/supabase/rpc";
import { realtimeStub, type FakeChannel, type RealtimeStub } from "@/test/supabase/realtime";
import { axeViolations, summarize } from "@/test/axe";
import { realT } from "@/test/i18nReal";
import { activeChannelCount } from "@/lib/realtime/tableChannelHub";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/notifications/preferences";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications/useNotifications";
import { NotificationsCenter } from "../NotificationsCenter";

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

/**
 * Rozmowa zwinięta w JEDNĄ grupę z trzech wierszy, z czego DWA nieprzeczytane
 * i jeden już przeczytany W ŚRODKU.
 *
 * Ten układ jest celowy: gdyby grupa była jednorodna, „najnowszy id",
 * „wszystkie id" i „nieprzeczytane id" dałyby ten sam wynik i test nie
 * wybierałby między nimi. Tutaj każdy z trzech wariantów jest inny.
 */
const ROZMOWA: NotificationRow[] = [
  notif({
    id: "n-msg-3",
    kind: "message",
    href: CONVERSATION_HREF,
    title_pl: "Anna Testowa",
    body_pl: "Trzecia wiadomość",
    created_at: "2026-08-20T13:00:00.000Z",
  }),
  notif({
    id: "n-msg-2",
    kind: "message",
    href: CONVERSATION_HREF,
    title_pl: "Anna Testowa",
    body_pl: "Druga wiadomość",
    read_at: "2026-08-20T12:30:00.000Z",
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

/** Wiersz komentarza - inny rodzaj, do dowodów o filtrze rodzaju. */
const KOMENTARZ = notif({
  id: "n-comment",
  kind: "comment",
  href: "/blog/analiza-rynku#komentarz-7",
  title_pl: "Nowy komentarz pod tekstem",
  body_pl: "Ktoś odpowiedział w wątku o rynku energii",
  icon: "bell",
  created_at: "2026-08-19T09:00:00.000Z",
});

/** Drugi wiersz NIEPRZECZYTANY spoza rozmowy - do dowodów o składzie listy. */
const ZAPROSZENIE = notif({
  id: "n-connection",
  kind: "connection",
  href: "/network/requests",
  title_pl: "Zaproszenie do sieci kontaktów",
  created_at: "2026-08-19T08:00:00.000Z",
});

/** Wiersz, którego szuka się WYŁĄCZNIE po adresie (tytuł i treść bez frazy). */
const DOSSIER = notif({
  id: "n-tracker",
  kind: "tracker",
  href: "/dossier/pakiet-energetyczny",
  title_pl: "Zmiana etapu dossier",
  body_pl: "Projekt wszedł w kolejny etap prac",
  read_at: "2026-08-18T08:00:00.000Z",
  created_at: "2026-08-18T07:00:00.000Z",
});

let db: SupabaseFromStub;
let rpc: SupabaseRpcStub;
let rt: RealtimeStub;
let rows: NotificationRow[] = [];

/** STRAŻNIK, nie rzutowanie - kanał atrapy ma obserwowalny `subscribeCount`. */
function isFakeChannel(value: unknown): value is FakeChannel {
  return (
    typeof value === "object" && value !== null && "subscribeCount" in value && "listeners" in value
  );
}

/** Argument łańcucha po indeksie, gdy jest napisem - bez rzutowań. */
function stringArg(args: ReadonlyArray<unknown> | undefined, index: number): string | null {
  const value = args?.[index];
  return typeof value === "string" ? value : null;
}

/** Argument łańcucha po indeksie, gdy jest liczbą. */
function numberArg(args: ReadonlyArray<unknown> | undefined, index: number): number | null {
  const value = args?.[index];
  return typeof value === "number" ? value : null;
}

/**
 * Odpowiedź tabeli `notifications` odtwarzająca zachowanie PostgREST-a
 * w zakresie, którego dotyka warstwa danych: filtr `is("read_at", null)`,
 * `eq("kind", ...)` i stronicowanie przez `range(from, to)`.
 *
 * Wierność stronicowania jest tu warunkiem sensu: `getNextPageParam` uznaje
 * stronę za ostatnią po jej DŁUGOŚCI, więc responder oddający zawsze pełną
 * listę udawałby, że „Załaduj więcej" jest zawsze potrzebne.
 */
function notificationsResponder(chain: {
  has: (method: string) => boolean;
  argsOf: (method: string) => ReadonlyArray<unknown> | undefined;
}) {
  // `update()` (oznacz wszystkie) i `delete()` nie czytają wierszy.
  if (!chain.has("select")) return ok(null);
  const onlyUnread = chain.has("is");
  const kind =
    stringArg(chain.argsOf("eq"), 0) === "kind" ? stringArg(chain.argsOf("eq"), 1) : null;
  const visible = rows.filter(
    (row) => (!onlyUnread || !row.read_at) && (kind === null || row.kind === kind),
  );
  const from = numberArg(chain.argsOf("range"), 0) ?? 0;
  const to = numberArg(chain.argsOf("range"), 1) ?? visible.length - 1;
  return ok(visible.slice(from, to + 1));
}

beforeEach(() => {
  // Odmontowanie POPRZEDNIEGO drzewa musi się wydarzyć przed podmianą atrap:
  // hub kanałów ma refcount na poziomie modułu, więc kanał zwolniony po
  // zamianie atrapy zostałby policzony w nowej instancji.
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
  h.toasts = [];
  h.pushSupported = true;
  h.vapidKey = "klucz-testowy";
  h.navigate.mockReset();
  h.navigate.mockResolvedValue(undefined);
  h.enablePush.mockReset();
  h.enablePush.mockResolvedValue(undefined);
  h.disablePush.mockReset();
  h.disablePush.mockResolvedValue(undefined);

  rows = [];
  db.setResponse("notifications", notificationsResponder);
  db.setResponse("notification_preferences", () => ok(DEFAULT_NOTIFICATION_PREFERENCES));
  db.setResponse("profiles", () => ok({ tenant_id: TENANT_ID }));
  rpc.setData("my_connections", []);
  rpc.setData("my_connection_requests", []);
  rpc.setData("mark_notifications_read", 2);
  rpc.setData("mark_notifications_unread", 3);
});

function withClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

/** Skrzynka z ZAKOŃCZONYM pierwszym odczytem. */
async function mountCenter(mode?: "full" | "inbox" | "preferences" | "consents") {
  const utils = withClient(mode ? <NotificationsCenter mode={mode} /> : <NotificationsCenter />);
  await waitFor(() => expect(db.chainsFor("notification_preferences").length).toBeGreaterThan(0));
  await act(async () => {});
  return utils;
}

// ---------------------------------------------------------------------------
// ODCZYTY EKRANU.
// ---------------------------------------------------------------------------

const searchBox = () => screen.getByLabelText(t("notifications.searchPlaceholder"));
const kindCombobox = () => screen.getByRole("combobox");
const listRows = () => screen.queryAllByRole("listitem");

/**
 * Wybór opcji w Radiksowym `Select`. Pod happy-dom warstwa rozwijana otwiera
 * się klawiaturą (`ArrowDown` na wyzwalaczu) - to prawdziwa ścieżka
 * użytkownika klawiatury, nie obejście: otwarcie wskaźnikiem wymagałoby
 * układu, którego happy-dom nie liczy. Opcję wybieramy klikiem, jak myszą.
 */
function chooseKind(optionName: string): void {
  fireEvent.keyDown(kindCombobox(), { key: "ArrowDown" });
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

/** Przełączenie zakładki - Radix Tabs reaguje na `mousedown`, nie na `click`. */
function switchTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

/**
 * Od tej chwili KAŻDY odczyt listy pada. Dzięki temu stan ekranu po ustaniu
 * ruchu pochodzi wyłącznie z cache (łatka albo jej cofnięcie), a nie ze
 * świeżego odczytu - patrz nagłówek pliku.
 */
function blockListReads(): void {
  db.setResponse("notifications", (chain) =>
    chain.has("select") ? fail("test: odczyt listy celowo zablokowany") : ok(null),
  );
}

describe("NotificationsCenter - lista, filtry i szukanie", () => {
  it("pusta skrzynka BEZ filtrów pokazuje komunikat o pustce, nie o braku dopasowań", async () => {
    await mountCenter();
    // Dwa RÓŻNE komunikaty dla dwóch różnych sytuacji: „nic nie masz" i „nic
    // nie pasuje". Zlanie ich w jeden zabiera użytkownikowi informację, że to
    // JEGO filtr ukrył treść.
    expect(await screen.findByText(t("notifications.empty"))).toBeInTheDocument();
    expect(screen.queryByText(t("notifications.noMatches"))).toBeNull();
  });

  it("szukanie po TYTULE zawęża listę", async () => {
    rows = [...ROZMOWA, KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    fireEvent.change(searchBox(), { target: { value: "komentarz" } });

    expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument();
    expect(screen.queryByText(DOSSIER.title_pl)).toBeNull();
    expect(listRows()).toHaveLength(1);
  });

  it("szukanie po TREŚCI (a nie tylko tytule) zawęża listę", async () => {
    rows = [...ROZMOWA, KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    // Fraza występuje WYŁĄCZNIE w treści - dopasowanie po samym tytule
    // zwróciłoby tu zero wyników.
    fireEvent.change(searchBox(), { target: { value: "rynku energii" } });

    expect(listRows()).toHaveLength(1);
    expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument();
  });

  it("szukanie po ADRESIE (href) zawęża listę", async () => {
    rows = [...ROZMOWA, KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(DOSSIER.title_pl);

    // „pakiet-energetyczny" nie pada ani w tytule, ani w treści - tylko
    // w `href`. To jedyny dowód, że wyszukiwarka czyta także adres, czyli że
    // da się znaleźć powiadomienie po dossier, którego tytułu się nie pamięta.
    fireEvent.change(searchBox(), { target: { value: "pakiet-energetyczny" } });

    expect(listRows()).toHaveLength(1);
    expect(screen.getByText(DOSSIER.title_pl)).toBeInTheDocument();
  });

  it("szukanie bez dopasowań pokazuje `noMatches`, nie `empty`", async () => {
    rows = [KOMENTARZ];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    fireEvent.change(searchBox(), { target: { value: "fraza-ktorej-nie-ma" } });

    expect(screen.getByText(t("notifications.noMatches"))).toBeInTheDocument();
    expect(screen.queryByText(t("notifications.empty"))).toBeNull();
  });

  it("filtr RODZAJU jedzie do zapytania jako eq(kind) i zawęża listę", async () => {
    rows = [...ROZMOWA, KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    chooseKind(t("notifications.settings.kinds.comment"));

    // Filtr rodzaju NIE jest sitem po stronie klienta - zmienia klucz cache
    // i leci do bazy. Bez `eq("kind", ...)` skrzynka pokazywałaby pierwszą
    // stronę WSZYSTKICH rodzajów przesianą lokalnie, czyli gubiłaby starsze
    // wiersze wybranego rodzaju.
    await waitFor(() => {
      const filtered = db.chainsFor("notifications").filter((chain) => chain.has("eq"));
      expect(filtered.at(-1)?.argsOf("eq")).toEqual(["kind", "comment"]);
    });
    await waitFor(() => expect(screen.queryByText(DOSSIER.title_pl)).toBeNull());
    expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument();
  });

  it("powrót na „wszystkie typy” zdejmuje eq(kind) i pokazuje pełną listę", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    chooseKind(t("notifications.settings.kinds.comment"));
    await waitFor(() => expect(screen.queryByText(DOSSIER.title_pl)).toBeNull());

    chooseKind(t("notifications.filters.allKinds"));

    await waitFor(() => expect(screen.getByText(DOSSIER.title_pl)).toBeInTheDocument());
    expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument();
  });

  it("filtr rodzaju bez wyników pokazuje `noMatches`", async () => {
    rows = [DOSSIER];
    await mountCenter();
    await screen.findByText(DOSSIER.title_pl);

    chooseKind(t("notifications.settings.kinds.comment"));

    expect(await screen.findByText(t("notifications.noMatches"))).toBeInTheDocument();
  });

  it("zakładka „Nieprzeczytane” przestawia filtr onlyUnread w warstwie danych", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(DOSSIER.title_pl);

    switchTab(t("notifications.filters.unread"));

    // Dowód jest w ZAPYTANIU: `is("read_at", null)` znaczy, że nieprzeczytane
    // wybiera baza. Sito po stronie klienta pokazywałoby tylko te
    // nieprzeczytane, które zmieściły się na już pobranej stronie.
    await waitFor(() => {
      const unreadReads = db.chainsFor("notifications").filter((chain) => chain.has("is"));
      expect(unreadReads.at(-1)?.argsOf("is")).toEqual(["read_at", null]);
    });
    await waitFor(() => expect(screen.queryByText(DOSSIER.title_pl)).toBeNull());
    expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AKCJE GRUPOWE - TU MIESZKA ŻYWY DEFEKT.
//
// USTALENIE (zmierzone, nie domysł). Każda mutacja skrzynki zaczyna się od
// `patchNotificationLists`, które bierze z cache WSZYSTKO, co przejdzie przez
// `NOTIFICATION_LIST_FILTERS`, i robi `cached.pages.map(...)`. Predykat
// `isNotificationListQuery` uznaje za listę każdy klucz trzyelementowy, którego
// trzeci człon jest `object` i nie jest `null` - a TABLICA spełnia oba warunki.
// Cache profili aktorów ma klucz `["notifications","actor-profiles", string[]]`
// i trzyma TABLICĘ profili, więc:
//
//   * przechodzi przez filtr list,
//   * `cached.pages` jest `undefined`,
//   * `undefined.map` rzuca TypeError WEWNĄTRZ `onMutate`.
//
// Skutek jest dokładnie tym, przed czym ostrzega nagłówek
// `notificationListKeys.ts`: MUTACJA NIGDY NIE DOBIEGA DO SERWERA. React Query
// przerywa na `onMutate`, `mutationFn` się nie wykonuje, a `onError` dostaje
// `context === undefined`, więc nie ma nawet czego cofnąć - listy, które pętla
// zdążyła przerobić przed wyjątkiem, zostają z łatką bez pokrycia w bazie.
//
// WARUNEK WYSTĄPIENIA: w skrzynce jest co najmniej jedno powiadomienie
// z adresem rozmowy (`/messages?c=<uuid>`), bo dopiero wtedy zapytanie
// o profile aktorów jest włączone i ma dane. Czyli: zawsze, gdy ktoś dostaje
// wiadomości na czacie. To nie jest przypadek brzegowy.
//
// Test różnicowy niżej („to samo kliknięcie dobiega do serwera, gdy wpis cache
// profili nie niesie tablicy") jest dowodem, że winowajcą jest kształt klucza,
// a nie sama akcja - i strażnikiem dla trzech `it.fails`: gdyby przestały padać
// z tego powodu, on zapali się pierwszy.
// ---------------------------------------------------------------------------

describe("NotificationsCenter - akcje grupowe na zwiniętej rozmowie", () => {
  it.fails(
    "DEFEKT: „oznacz całą rozmowę” ma wysłać WSZYSTKIE nieprzeczytane id - nie wysyła niczego, bo onMutate wywraca się na cache profili aktorów",
    async () => {
      rows = [...ROZMOWA];
      await mountCenter();
      await screen.findByText(/Anna Testowa/);

      fireEvent.click(screen.getByRole("button", { name: t("notifications.markGroupRead") }));

      // OCZEKIWANY KONTRAKT: komplet nieprzeczytanych id grupy (środkowy wiersz
      // jest już przeczytany, więc jadą dwa). Wysłanie samego najnowszego
      // zostawiłoby „n-msg-1" i rozmowa wróciłaby jako nowa grupa.
      await waitFor(() => expect(rpc.lastCall("mark_notifications_read")).toBeDefined());
      expect(rpc.lastCall("mark_notifications_read")?.arg("p_ids")).toEqual(["n-msg-3", "n-msg-1"]);
    },
  );

  it.fails(
    "DEFEKT: „oznacz jako nieprzeczytane” ma wysłać WSZYSTKIE id grupy - nie wysyła niczego (ta sama przyczyna)",
    async () => {
      rows = ROZMOWA.map((row) => ({ ...row, read_at: "2026-08-20T14:00:00.000Z" }));
      await mountCenter();
      await screen.findByText(/Anna Testowa/);

      fireEvent.click(screen.getByRole("button", { name: t("notifications.markGroupUnread") }));

      // OCZEKIWANY KONTRAKT: wszystkie trzy id - „przywróć rozmowę do
      // nieprzeczytanych" dotyczy całej rozmowy, nie ostatniej wiadomości.
      await waitFor(() => expect(rpc.lastCall("mark_notifications_unread")).toBeDefined());
      expect(rpc.lastCall("mark_notifications_unread")?.arg("p_ids")).toEqual([
        "n-msg-3",
        "n-msg-2",
        "n-msg-1",
      ]);
    },
  );

  it.fails(
    "DEFEKT: kosz ma skasować KAŻDE id grupy - nie kasuje niczego (ta sama przyczyna)",
    async () => {
      rows = [...ROZMOWA];
      await mountCenter();
      await screen.findByText(/Anna Testowa/);

      fireEvent.click(screen.getByRole("button", { name: t("notifications.deleteGroup") }));

      // OCZEKIWANY KONTRAKT: `delete().in("id", [wszystkie trzy])`. Skasowanie
      // samego najnowszego wiersza zostawiałoby resztę rozmowy, która przy
      // najbliższym odczycie wraca jako „nowa" grupa - użytkownik kasuje ten
      // sam wątek w kółko. Dziś nie leci nawet to.
      await waitFor(() => {
        const usuniecie = db.chainsFor("notifications").find((chain) => chain.has("delete"));
        expect(usuniecie?.argsOf("in")).toEqual(["id", ["n-msg-3", "n-msg-2", "n-msg-1"]]);
      });
    },
  );

  it("RÓŻNICOWO: gdy wpis cache profili aktorów nie niesie tablicy, to samo kliknięcie dobiega do serwera", async () => {
    // Ten sam ekran, ta sama grupa, ten sam przycisk. Różni się WYŁĄCZNIE to,
    // że zapytanie o profile aktorów kończy się błędem, więc jego wpis w cache
    // ma `data === undefined` i pętla po listach go pomija (`if (!cached)
    // continue`). Mutacja wtedy przechodzi w całości. To lokalizuje defekt
    // w kształcie klucza cache, a nie w akcji grupowej - i pilnuje, żeby trzy
    // `it.fails` wyżej nie zaczęły kiedyś „padać" z zupełnie innego powodu.
    rpc.setError("my_connections", "brak dostępu do listy kontaktów");
    rows = [...ROZMOWA];
    await mountCenter();
    await screen.findByText(/Anna Testowa/);

    fireEvent.click(screen.getByRole("button", { name: t("notifications.markGroupRead") }));

    await waitFor(() => expect(rpc.lastCall("mark_notifications_read")).toBeDefined());
    expect(rpc.lastCall("mark_notifications_read")?.arg("p_ids")).toEqual(["n-msg-3", "n-msg-1"]);
  });

  it("wiersz POJEDYNCZY dostaje etykiety bez wariantu grupowego", async () => {
    rows = [KOMENTARZ];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    // Etykieta „całą rozmowę" na jednym powiadomieniu byłaby kłamstwem
    // o zasięgu akcji - stąd osobna gałąź i osobny dowód.
    expect(screen.getByRole("button", { name: t("notifications.markRead") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("common.delete") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("notifications.markGroupRead") })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// OPTYMIZM I COFNIĘCIE.
//
// Fixture'y tej sekcji NIE zawierają powiadomień o rozmowie - świadomie.
// Defekt opisany wyżej przerywa pętlę po cache w połowie, więc na danych
// z rozmową „co się załatało" zależałoby od KOLEJNOŚCI wpisów w cache. Dowód
// o optymizmie ma mierzyć warstwę optymizmu, a nie kolejność wstawek, więc
// bierzemy dane, na których pętla przechodzi w całości.
// ---------------------------------------------------------------------------

describe("NotificationsCenter - optymistyczna aktualizacja i cofnięcie", () => {
  it("na zakładce „Wszystkie” wiersz od razu wygląda na przeczytany i ZOSTAJE na liście", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);
    blockListReads();

    fireEvent.click(screen.getByRole("button", { name: t("notifications.markRead") }));

    // Odczyt jest zablokowany, więc zmiana stanu może pochodzić WYŁĄCZNIE
    // z łatki cache. Po oznaczeniu OBA wiersze są przeczytane, więc obie akcje
    // odwracają się na „oznacz jako nieprzeczytane", a odznaka licznika znika.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: t("notifications.markUnread") })).toHaveLength(
        2,
      ),
    );
    expect(screen.queryByLabelText(t("notifications.unread", { count: 1 }))).toBeNull();
    // Na zakładce „Wszystkie" zmienia się STAN, nie skład listy.
    expect(listRows()).toHaveLength(2);
  });

  it("na zakładce „Nieprzeczytane” oznaczony wiersz ZNIKA z listy", async () => {
    rows = [KOMENTARZ, ZAPROSZENIE, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    switchTab(t("notifications.filters.unread"));
    await waitFor(() => expect(listRows()).toHaveLength(2));
    blockListReads();

    fireEvent.click(screen.getAllByRole("button", { name: t("notifications.markRead") })[0]!);

    // Bez rozróżnienia kluczy `onlyUnread` (`listKeyIsOnlyUnread`) wiersz
    // zostałby na liście nieprzeczytanych jako „przeczytany" - czyli filtr
    // kłamałby do najbliższej inwalidacji.
    await waitFor(() => expect(listRows()).toHaveLength(1));
    expect(screen.getByText(ZAPROSZENIE.title_pl)).toBeInTheDocument();
    expect(screen.queryByText(KOMENTARZ.title_pl)).toBeNull();
  });

  it("błąd RPC COFA łatkę - widok wraca do stanu sprzed kliknięcia", async () => {
    rows = [KOMENTARZ];
    rpc.setError("mark_notifications_read", "odmowa bazy", "42501");
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);
    blockListReads();

    fireEvent.click(screen.getByRole("button", { name: t("notifications.markRead") }));

    await waitFor(() => expect(rpc.callsFor("mark_notifications_read")).toHaveLength(1));
    // Odczyt po mutacji jest zablokowany, więc powrót do „nieprzeczytane" może
    // pochodzić wyłącznie z `onError` -> rollback. Bez cofnięcia ekran zostałby
    // na optymistycznym „przeczytane", którego w bazie nie ma - i to jest
    // dokładnie ta cicha rozbieżność, którą użytkownik zgłasza jako „licznik
    // nieprzeczytanych czasem się nie zgadza".
    await waitFor(() =>
      expect(screen.getByRole("button", { name: t("notifications.markRead") })).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(t("notifications.unread", { count: 1 }))).toBeInTheDocument();
  });

  it("kosz usuwa wiersz z listy OPTYMISTYCZNIE, bez czekania na ponowny odczyt", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    // Kasowanie UDAJE SIĘ, ale odczyt jest zablokowany, a `rows` (czyli „stan
    // serwera" w atrapie) świadomie NIE zmienia się. Zniknięcie wiersza z
    // ekranu może więc pochodzić wyłącznie z łatki cache.
    blockListReads();
    fireEvent.click(screen.getAllByRole("button", { name: t("common.delete") })[0]!);

    await waitFor(() => expect(screen.queryByText(KOMENTARZ.title_pl)).toBeNull());
    expect(screen.getByText(DOSSIER.title_pl)).toBeInTheDocument();
  });

  it("odmowa bazy PRZYWRACA skasowany wiersz", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    // Kasowanie i odczyt idą tą samą tabelą, więc responder rozróżnia je po
    // ogniwie: `select` pada (blokada odczytu), `delete` dostaje odmowę RLS.
    db.setResponse("notifications", (chain) =>
      chain.has("select") ? fail("test: odczyt zablokowany") : fail("odmowa bazy", "42501"),
    );

    fireEvent.click(screen.getAllByRole("button", { name: t("common.delete") })[0]!);

    // Kasowanie zostało PODJĘTE (a nie po cichu pominięte)...
    await waitFor(() => {
      const usuniecie = db.chainsFor("notifications").find((chain) => chain.has("delete"));
      expect(usuniecie?.argsOf("in")).toEqual(["id", [KOMENTARZ.id]]);
    });
    // ...i po odmowie wiersz jest z powrotem na ekranie. Kosz nie może „udać
    // się" wizualnie, gdy RLS odmówił - inaczej powiadomienie znika i wraca
    // dopiero po odświeżeniu strony, a użytkownik jest przekonany, że skasował.
    // Odczyt jest zablokowany, więc powrót pochodzi z cofnięcia, nie z fetcha.
    await waitFor(() => expect(screen.getByText(KOMENTARZ.title_pl)).toBeInTheDocument());
  });
});

describe("NotificationsCenter - paginacja", () => {
  it("bez kolejnej strony NIE renderuje „Załaduj więcej”", async () => {
    rows = [KOMENTARZ, DOSSIER];
    await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);
    expect(screen.queryByRole("button", { name: t("notifications.loadMore") })).toBeNull();
  });

  it("pełna strona pokazuje przycisk, a klik dociąga NASTĘPNY zakres", async () => {
    // Dokładnie `NOTIFICATIONS_PAGE_SIZE` wierszy to granica, na której
    // `getNextPageParam` uznaje, że może być więcej. Liczba pochodzi ze stałej,
    // nie z literału - zmiana rozmiaru strony ma przestawić test razem z kodem.
    rows = Array.from({ length: NOTIFICATIONS_PAGE_SIZE + 3 }, (_unused, index) =>
      notif({ id: `n-${index}`, title_pl: `Powiadomienie ${index}` }),
    );
    await mountCenter();
    await screen.findByText("Powiadomienie 0");

    fireEvent.click(screen.getByRole("button", { name: t("notifications.loadMore") }));

    await waitFor(() => {
      const ranges = db
        .chainsFor("notifications")
        .map((chain) => chain.argsOf("range"))
        .filter((args): args is ReadonlyArray<unknown> => args !== undefined);
      expect(ranges.at(-1)).toEqual([NOTIFICATIONS_PAGE_SIZE, NOTIFICATIONS_PAGE_SIZE * 2 - 1]);
    });
    expect(
      await screen.findByText(`Powiadomienie ${NOTIFICATIONS_PAGE_SIZE + 2}`),
    ).toBeInTheDocument();
  });
});

describe("NotificationsCenter - realtime", () => {
  it("zakłada kanały tabel `notifications` i `notification_preferences`", async () => {
    await mountCenter();
    const lista = rt.channelByPrefix("hub:public|notifications|");
    const prefs = rt.channelByPrefix("hub:public|notification_preferences|");
    // Filtr po `user_id` to optymalizacja pasma (izolację wymusza RLS), ale
    // jego zgubienie zamienia kanał w firehose całego najemcy.
    expect(lista?.listeners[0]?.filter).toMatchObject({
      table: "notifications",
      filter: `user_id=eq.${USER_ID}`,
    });
    expect(prefs?.listeners[0]?.filter).toMatchObject({ table: "notification_preferences" });
    expect(rt.liveChannels("hub:")).toHaveLength(2);
  });

  it("zdarzenie INSERT odświeża listę (unieważnienie cache prowadzi do odczytu)", async () => {
    await mountCenter();
    expect(await screen.findByText(t("notifications.empty"))).toBeInTheDocument();

    rows = [notif({ id: "n-live", title_pl: "Wpłynęło nowe zaproszenie", kind: "connection" })];
    const channel = rt.channelByPrefix("hub:public|notifications|");
    await act(async () => {
      channel?.emitPostgres("notifications", {
        eventType: "INSERT",
        new: { id: "n-live", kind: "connection" },
      });
    });

    // Dowód dotyczy SKUTKU: zdarzenie ma doprowadzić do ponownego odczytu,
    // a nie tylko przemielić ładunek.
    expect(await screen.findByText("Wpłynęło nowe zaproszenie")).toBeInTheDocument();
  });

  it("ODMONTOWANIE zwalnia oba kanały - refcount wraca do zera", async () => {
    const { unmount } = await mountCenter();
    const lista = rt.channelByPrefix("hub:public|notifications|");
    const prefs = rt.channelByPrefix("hub:public|notification_preferences|");

    act(() => unmount());

    // Zgubiony `removeChannel` nie psuje widoku od razu - dopiero po kilku
    // przejściach między trasami kończy się limit kanałów Realtime i skrzynka
    // przestaje dostawać zdarzenia.
    expect(lista?.removed).toBe(true);
    expect(prefs?.removed).toBe(true);
    expect(rt.liveChannels("hub:")).toHaveLength(0);
    expect(activeChannelCount()).toBe(0);
  });
});

describe("NotificationsCenter - tryby", () => {
  it("tryb `full` ma trzy zakładki: wszystkie, nieprzeczytane, ustawienia", async () => {
    await mountCenter("full");
    expect(screen.getByRole("tab", { name: t("notifications.filters.all") })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: t("notifications.filters.unread") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: t("notifications.filters.settings") }),
    ).toBeInTheDocument();
  });

  it("tryb `inbox` NIE pokazuje zakładki ustawień ani przełączników rodzajów", async () => {
    await mountCenter("inbox");
    expect(screen.getByRole("tab", { name: t("notifications.filters.all") })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: t("notifications.filters.settings") })).toBeNull();
    // Skrzynka osadzona w /messages ma być SKRZYNKĄ - ustawienia mieszkają pod
    // własnym adresem i tam mają zostać.
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("tryb `preferences` montuje ustawienia z przełącznikami rodzajów", async () => {
    await mountCenter("preferences");

    expect(
      screen.getByRole("heading", { name: t("notifications.settings.kindsHeader") }),
    ).toBeInTheDocument();
    // Przełącznik rodzaju to molekuła `NotificationKindToggle` - tu dowodzimy
    // SKLEJENIA: że katalog rodzajów naprawdę zamienia się w wiersze.
    expect(screen.getByLabelText(t("notifications.settings.kinds.message"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("notifications.settings.kinds.crm_task"))).toBeInTheDocument();
    // Alerty bezpieczeństwa: wariant always-on, zawsze zablokowany.
    expect(screen.getByLabelText(t("notifications.settings.kinds.security"))).toBeDisabled();
    // Ustawienia nie niosą skrzynki.
    expect(screen.queryByLabelText(t("notifications.searchPlaceholder"))).toBeNull();
  });

  it("tryb `consents` montuje panel zgód zamiast skrzynki i ustawień", async () => {
    await mountCenter("consents");
    expect(screen.getByTestId("consents-panel")).toBeInTheDocument();
    expect(screen.queryByLabelText(t("notifications.searchPlaceholder"))).toBeNull();
    expect(screen.queryByLabelText(t("notifications.settings.kinds.message"))).toBeNull();
  });
});

describe("NotificationsCenter - zapis preferencji", () => {
  it("przełączenie rodzaju zapisuje flagę i pokazuje toast sukcesu", async () => {
    await mountCenter("preferences");

    fireEvent.click(screen.getByLabelText(t("notifications.settings.kinds.message")));

    await waitFor(() => {
      const upsert = db.chainsFor("notification_preferences").find((chain) => chain.has("upsert"));
      expect(upsert?.argsOf("upsert")?.[0]).toMatchObject({
        user_id: USER_ID,
        tenant_id: TENANT_ID,
        enabled_message: false,
      });
    });
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "success",
        text: t("notifications.settings.saved"),
      }),
    );
  });

  it("odmowa zapisu pokazuje toast błędu, nie ciszę", async () => {
    db.setResponse("notification_preferences", (chain) =>
      chain.has("upsert") ? fail("odmowa bazy", "42501") : ok(DEFAULT_NOTIFICATION_PREFERENCES),
    );
    await mountCenter("preferences");

    fireEvent.click(screen.getByLabelText(t("notifications.settings.groupByConversation")));

    // Cichy błąd zapisu preferencji jest gorszy niż brak zapisu: przełącznik
    // wraca na starą wartość dopiero po odświeżeniu, więc użytkownik do końca
    // sesji jest przekonany, że coś wyłączył.
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("notifications.settings.saveError"),
      }),
    );
  });
});

describe("NotificationsCenter - kanał push", () => {
  const pushSwitch = () => screen.getByLabelText(t("notifications.settings.push"));

  it("bez wsparcia przeglądarki przełącznik jest zablokowany i mówi dlaczego", async () => {
    h.pushSupported = false;
    await mountCenter("preferences");

    expect(pushSwitch()).toBeDisabled();
    expect(screen.getByText(t("notifications.settings.pushUnsupported"))).toBeInTheDocument();
    expect(screen.queryByText(t("notifications.settings.pushHint"))).toBeNull();
  });

  it("bez ustalonego klucza VAPID przełącznik pozostaje zablokowany", async () => {
    // Klucz jest SEKRETEM pobieranym z serwera, więc dostępność push ustala się
    // dopiero po hydracji. Do tego czasu czynny przełącznik obiecywałby kanał,
    // którego nie da się uruchomić.
    h.vapidKey = null;
    await mountCenter("preferences");

    expect(pushSwitch()).toBeDisabled();
    expect(screen.getByText(t("notifications.settings.pushUnsupported"))).toBeInTheDocument();
  });

  it("włączenie push rejestruje przeglądarkę i zapisuje push_enabled", async () => {
    await mountCenter("preferences");
    await waitFor(() => expect(pushSwitch()).toBeEnabled());

    fireEvent.click(pushSwitch());

    // Kolejność ma znaczenie: najpierw zgoda przeglądarki i subskrypcja,
    // dopiero potem zapis preferencji. Zapisane `push_enabled: true` bez
    // subskrypcji to kanał, który nigdy nic nie doręczy.
    await waitFor(() => expect(h.enablePush).toHaveBeenCalledWith(USER_ID));
    await waitFor(() => {
      const upsert = db.chainsFor("notification_preferences").find((chain) => chain.has("upsert"));
      expect(upsert?.argsOf("upsert")?.[0]).toMatchObject({ push_enabled: true });
    });
  });

  it("ODMOWA zgody pokazuje INNY komunikat niż błąd ogólny i nie zapisuje flagi", async () => {
    h.enablePush.mockRejectedValue(new Error("push_denied"));
    await mountCenter("preferences");
    await waitFor(() => expect(pushSwitch()).toBeEnabled());

    fireEvent.click(pushSwitch());

    // „Przeglądarka odmówiła" jest do naprawienia przez użytkownika
    // (ustawienia witryny), „nie udało się" - nie. Zlanie obu w jeden komunikat
    // zostawia człowieka bez instrukcji.
    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("notifications.settings.pushDenied"),
      }),
    );
    expect(h.toasts).not.toContainEqual({
      kind: "error",
      text: t("notifications.settings.pushError"),
    });
    expect(db.chainsFor("notification_preferences").some((chain) => chain.has("upsert"))).toBe(
      false,
    );
  });

  it("błąd inny niż odmowa pokazuje komunikat ogólny", async () => {
    h.enablePush.mockRejectedValue(new Error("push_bad_subscription"));
    await mountCenter("preferences");
    await waitFor(() => expect(pushSwitch()).toBeEnabled());

    fireEvent.click(pushSwitch());

    await waitFor(() =>
      expect(h.toasts).toContainEqual({
        kind: "error",
        text: t("notifications.settings.pushError"),
      }),
    );
  });

  it("wyłączenie push usuwa subskrypcję TEJ przeglądarki i zapisuje flagę", async () => {
    db.setResponse("notification_preferences", (chain) =>
      chain.has("upsert")
        ? ok(null)
        : ok({ ...DEFAULT_NOTIFICATION_PREFERENCES, push_enabled: true }),
    );
    await mountCenter("preferences");
    await waitFor(() => expect(pushSwitch()).toBeEnabled());

    fireEvent.click(pushSwitch());

    await waitFor(() => expect(h.disablePush).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const upsert = db.chainsFor("notification_preferences").find((chain) => chain.has("upsert"));
      expect(upsert?.argsOf("upsert")?.[0]).toMatchObject({ push_enabled: false });
    });
  });
});

describe("NotificationsCenter - nawigacja z wiersza", () => {
  it("klik w odnośnik wewnętrzny nawiguje przez router i ZACHOWUJE query string", async () => {
    rows = [...ROZMOWA];
    await mountCenter();
    await screen.findByText(/Anna Testowa/);

    const link = screen.getByRole("link", { name: /Anna Testowa/ });
    expect(link).toHaveAttribute("href", CONVERSATION_HREF);
    // `<Link to={href}>` gubiłby `?c=<uuid>` (traktuje `to` jak czystą
    // ścieżkę), więc wiersz rozmowy lądowałby na pustej liście czatów.
    // `fireEvent` zwraca false, gdy zdarzenie zostało anulowane - to jedyny
    // sposób zobaczenia `preventDefault()` bez zaglądania do implementacji.
    expect(fireEvent.click(link)).toBe(false);
    expect(h.navigate).toHaveBeenCalledWith({ href: CONVERSATION_HREF });
  });

  it("klik z modyfikatorem zostawia natywne zachowanie kotwicy", async () => {
    rows = [...ROZMOWA];
    await mountCenter();
    await screen.findByText(/Anna Testowa/);

    // Brak `preventDefault` (zwrot true) ORAZ brak nawigacji SPA - dopiero oba
    // naraz znaczą „otwórz w nowej karcie działa". Oznaczenie wiersza jako
    // przeczytanego jest w tej ścieżce nieosiągalne przez defekt opisany
    // w sekcji akcji grupowych, więc dowód dotyczy tu wyłącznie nawigacji.
    const link = screen.getByRole("link", { name: /Anna Testowa/ });
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// DOSTĘPNOŚĆ.
// ---------------------------------------------------------------------------

/**
 * Czy naruszenie dotyczy WYŁĄCZNIE wyzwalacza Radiksowego `Select`.
 *
 * ARTEFAKT ŚRODOWISKA, NIE DEFEKT PRODUKTU. `button-name` szuka tekstu
 * widocznego dla czytnika ekranu, a Radix trzyma etykietę wyzwalacza
 * w ZAGNIEŻDŻONYM `<span>`. happy-dom nie ma silnika układu, więc axe nie umie
 * potwierdzić widoczności tego dziecka i uznaje przycisk za bezimienny - ten
 * sam wynik daje gołe `<button><span>tekst</span></button>` bez żadnego
 * Radiksa (zmierzone osobną próbką). W przeglądarce nazwa istnieje, co ten plik
 * dokłada asercją na `textContent`. Filtr jest WĄSKI: jedna reguła i jeden
 * węzeł, więc bezimienny przycisk gdziekolwiek indziej nadal oblewa test.
 */
function isSelectTriggerArtifact(violation: Result, node: NodeResult): boolean {
  if (violation.id !== "button-name") return false;
  const selector = node.target[0];
  return typeof selector === "string" && document.querySelector(selector) === kindCombobox();
}

describe("NotificationsCenter - dostępność", () => {
  it("skrzynka z listą nie ma naruszeń axe", async () => {
    rows = [...ROZMOWA, KOMENTARZ, DOSSIER];
    const { container } = await mountCenter();
    await screen.findByText(KOMENTARZ.title_pl);

    const violations = await axeViolations(container);
    const realne = violations.filter(
      (violation) => !violation.nodes.every((node) => isSelectTriggerArtifact(violation, node)),
    );
    expect(realne, summarize(realne)).toEqual([]);
    // Dowód, że odfiltrowane naruszenie NIE jest brakiem nazwy w produkcie:
    // wyzwalacz filtra niesie widoczny tekst wybranej opcji.
    expect(kindCombobox()).toHaveTextContent(t("notifications.filters.allKinds"));
  });

  it("ustawienia z przełącznikami nie mają naruszeń axe", async () => {
    const { container } = await mountCenter("preferences");
    await screen.findByLabelText(t("notifications.settings.kinds.message"));

    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});
